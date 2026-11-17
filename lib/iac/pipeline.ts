/**
 * Server-side Terraform checks: fmt → init (no backend) → validate.
 *
 * Safety properties:
 *  - Only `fmt`, `init -backend=false` and `validate` can run. There is no
 *    code path to `plan` or `apply` in this module.
 *  - The child process environment has every AWS_* variable removed, so the
 *    checks cannot reach an AWS account even if the server has credentials.
 *  - Commands run without a shell (execFile + argument arrays).
 *  - File names are restricted to a flat allow-list pattern (no traversal).
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type StepName = "fmt" | "init" | "validate";
export type StepStatus = "passed" | "failed" | "skipped";

export interface TfDiagnostic {
  severity: "error" | "warning";
  summary: string;
  detail?: string;
  file?: string;
  line?: number;
}

export interface StepResult {
  step: StepName;
  status: StepStatus;
  durationMs: number;
  /** Trimmed combined output, useful for display. */
  output: string;
  diagnostics: TfDiagnostic[];
}

export interface PipelineResult {
  terraformVersion: string | null;
  steps: StepResult[];
  ok: boolean;
}

export const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}\.(tf|tfvars\.example)$/i;
export const MAX_TOTAL_BYTES = 512 * 1024;

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase().startsWith("AWS_")) continue;
    env[k] = v;
  }
  env.TF_IN_AUTOMATION = "1";
  env.TF_INPUT = "0";
  env.CHECKPOINT_DISABLE = "1";
  return env as NodeJS.ProcessEnv;
}

function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { cwd, env: sanitizedEnv(), timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? Number((error as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : "")) });
      }
    );
  });
}

/** Resolve the terraform binary: $TERRAFORM_BIN, else `terraform` on PATH. */
export async function findTerraform(): Promise<{ bin: string; version: string } | null> {
  const bin = process.env.TERRAFORM_BIN || "terraform";
  const res = await run(bin, ["version", "-json"], process.cwd(), 20_000);
  if (res.code !== 0) return null;
  try {
    return { bin, version: JSON.parse(res.stdout).terraform_version as string };
  } catch {
    return null;
  }
}

function parseValidateJson(stdout: string): TfDiagnostic[] {
  try {
    const parsed = JSON.parse(stdout) as {
      diagnostics?: { severity: string; summary: string; detail?: string; range?: { filename?: string; start?: { line?: number } } }[];
    };
    return (parsed.diagnostics ?? []).map((d) => ({
      severity: d.severity === "warning" ? "warning" : "error",
      summary: d.summary,
      detail: d.detail || undefined,
      file: d.range?.filename,
      line: d.range?.start?.line,
    }));
  } catch {
    return [];
  }
}

/** Parse human-readable init errors ("Error: ...\n\n  on main.tf line 3"). */
function parseHumanErrors(text: string): TfDiagnostic[] {
  const out: TfDiagnostic[] = [];
  const re = /(Error|Warning): ([^\n]+)\n(?:\s*\n)?(?:\s*on ([^\s]+) line (\d+)[^\n]*\n)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      severity: m[1] === "Warning" ? "warning" : "error",
      summary: m[2].trim(),
      file: m[3],
      line: m[4] ? Number(m[4]) : undefined,
    });
  }
  return out;
}

export function assertSafeFiles(files: Record<string, string>): void {
  let total = 0;
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_FILE_NAME.test(name) || name.includes("..") || path.basename(name) !== name) {
      throw new Error(`Unsafe file name: ${name}`);
    }
    total += Buffer.byteLength(content, "utf8");
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`Configuration exceeds ${MAX_TOTAL_BYTES} bytes`);
}

export interface RunOptions {
  bin: string;
  version?: string;
  timeoutMs?: number;
  /** Keep the working directory (for debugging). */
  keepWorkDir?: boolean;
}

export async function runTerraformChecks(files: Record<string, string>, opts: RunOptions): Promise<PipelineResult> {
  assertSafeFiles(files);
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const dir = await mkdtemp(path.join(tmpdir(), "cloudsentinel-tf-"));
  const steps: StepResult[] = [];

  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(dir, name), content, "utf8");
    }

    const t0 = Date.now();
    const fmt = await run(opts.bin, ["fmt", "-check", "-diff", "-no-color"], dir, timeoutMs);
    const unformatted = fmt.stdout.split(/\r?\n/).filter((l) => SAFE_FILE_NAME.test(l.trim()));
    steps.push({
      step: "fmt",
      status: fmt.code === 0 ? "passed" : "failed",
      durationMs: Date.now() - t0,
      output: (fmt.stdout + fmt.stderr).trim().slice(0, 20_000),
      diagnostics: fmt.code === 0 ? [] : (unformatted.length ? unformatted : ["(unknown)"]).map((f) => ({
        severity: "warning" as const,
        summary: "File is not in canonical format. Run `terraform fmt`.",
        file: f.trim(),
      })),
    });

    const t1 = Date.now();
    const init = await run(opts.bin, ["init", "-backend=false", "-input=false", "-no-color"], dir, timeoutMs);
    const initOk = init.code === 0;
    steps.push({
      step: "init",
      status: initOk ? "passed" : "failed",
      durationMs: Date.now() - t1,
      output: (init.stdout + init.stderr).trim().slice(-20_000),
      diagnostics: initOk ? [] : parseHumanErrors(init.stderr + init.stdout),
    });

    if (!initOk) {
      steps.push({ step: "validate", status: "skipped", durationMs: 0, output: "Skipped because init failed.", diagnostics: [] });
    } else {
      const t2 = Date.now();
      const val = await run(opts.bin, ["validate", "-json", "-no-color"], dir, timeoutMs);
      const diagnostics = parseValidateJson(val.stdout);
      steps.push({
        step: "validate",
        status: val.code === 0 ? "passed" : "failed",
        durationMs: Date.now() - t2,
        output: (val.stdout + val.stderr).trim().slice(0, 20_000),
        diagnostics,
      });
    }
  } finally {
    if (!opts.keepWorkDir) await rm(dir, { recursive: true, force: true });
  }

  // fmt problems are reported but do not make the configuration invalid.
  const ok = steps.every((s) => s.step === "fmt" || s.status === "passed");
  return { terraformVersion: opts.version ?? null, steps, ok };
}
