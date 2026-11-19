import { findTerraform, runTerraformChecks, type PipelineResult } from "@/lib/iac/pipeline";

export const terraform = await findTerraform();

if (!terraform && process.env.REQUIRE_TERRAFORM === "1") {
  // CI sets this so a missing binary fails the job instead of silently skipping.
  throw new Error("[terraform tests] REQUIRE_TERRAFORM=1 but no terraform binary was found.");
}
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

/**
 * On Windows terraform copies the (large) provider binary out of the plugin
 * cache for every init; parallel copies race and get blocked by Application
 * Control. Linux symlinks from the cache, so concurrency is safe there.
 */
export const parallelSafe = process.platform !== "win32";
