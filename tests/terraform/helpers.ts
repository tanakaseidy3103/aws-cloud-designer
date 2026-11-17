import { findTerraform, runTerraformChecks, type PipelineResult } from "@/lib/iac/pipeline";

export const terraform = await findTerraform();

if (!terraform) {
  console.warn(
    "[terraform tests] terraform binary not found (set TERRAFORM_BIN or add it to PATH) — tests are skipped."
  );
}

/** Readable failure message listing every non-passing step. */
export function describeFailures(result: PipelineResult): string {
  return result.steps
    .filter((s) => s.status !== "passed")
    .map((s) => `${s.step}: ${s.status}\n${s.diagnostics.map((d) => `  ${d.file ?? ""}:${d.line ?? ""} ${d.summary}${d.detail ? ` — ${d.detail}` : ""}`).join("\n")}\n${s.output.slice(0, 2000)}`)
    .join("\n\n");
}

export async function check(files: Record<string, string>): Promise<PipelineResult> {
  if (!terraform) throw new Error("terraform not available");
  return runTerraformChecks(files, { bin: terraform.bin, version: terraform.version });
}
