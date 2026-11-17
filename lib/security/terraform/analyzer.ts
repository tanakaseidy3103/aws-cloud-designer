/**
 * Static security analysis of Terraform configurations.
 *
 *   sources (file → text) → parse (lib/hcl-parser) → rules (TF-*) → TfReport
 *
 * Pure and deterministic: no filesystem, network, AWS credentials or
 * terraform binary. The same input always yields the same report.
 */

import { parseHcl } from "@/lib/hcl-parser/parser";
import { SEVERITY_ORDER, type Severity } from "@/lib/security/types";
import { AnalysisContext } from "./context";
import { TERRAFORM_RULES, type TfRule } from "./rules";
import type { TfNotAnalyzed, TfReport } from "./types";

export * from "./types";
export { TERRAFORM_RULES, TERRAFORM_RULE_IDS } from "./rules";

/** Types that carry no security-relevant settings checked here, by design. */
const NEUTRAL_TYPES = new Set([
  "aws_vpc",
  "aws_route_table",
  "aws_route",
  "aws_route_table_association",
  "aws_internet_gateway",
  "aws_eip",
  "aws_nat_gateway",
  "aws_default_security_group",
  "aws_s3_bucket_ownership_controls",
  "aws_iam_role",
  "aws_iam_instance_profile",
  "aws_cloudwatch_log_group",
  "aws_db_subnet_group",
  "aws_lb_target_group",
  "aws_lb_target_group_attachment",
  "aws_lambda_permission",
  "aws_vpc_security_group_egress_rule",
  "aws_vpc_endpoint",
  "aws_flow_log",
]);

export function analyzeTerraform(sources: Record<string, string>, rules: readonly TfRule[] = TERRAFORM_RULES): TfReport {
  const fileNames = Object.keys(sources).filter((f) => f.endsWith(".tf") || f.endsWith(".tf.json")).sort();
  const parsed = fileNames.map((f) => parseHcl(sources[f], f));
  const ctx = new AnalysisContext(parsed, Object.fromEntries(fileNames.map((f) => [f, sources[f]])));

  for (const rule of rules) rule.run(ctx);

  const notAnalyzed: TfNotAnalyzed[] = [];
  for (const r of ctx.resources) {
    if (ctx.analyzed.has(r.address)) continue;
    const neutral = NEUTRAL_TYPES.has(r.type);
    notAnalyzed.push({
      address: r.address,
      type: r.type,
      file: r.file,
      line: r.line,
      reason: neutral
        ? "No rule applies to this type's settings (reviewed as low-risk); its absence from findings is not a security verdict."
        : "No rule covers this resource type. It was not checked.",
    });
  }
  for (const f of parsed) {
    for (const b of f.body.blocks.filter((x) => x.type === "module")) {
      notAnalyzed.push({ address: `module.${b.labels[0] ?? "?"}`, type: "module", file: f.file, line: b.range.line, reason: "Module sources are not loaded; resources inside the module were not checked." });
    }
  }

  const findings = [...ctx.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId)
  );
  const unresolved = [...ctx.unresolved].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  notAnalyzed.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const filesWithErrors = parsed.filter((f) => !f.ok).length;
  const complete = filesWithErrors === 0 && unresolved.length === 0;

  return {
    schemaVersion: 1,
    tool: "cloudsentinel-terraform-analyzer",
    status: findings.length ? "findings" : complete ? "clean" : "incomplete",
    complete,
    summary: {
      files: parsed.length,
      filesWithErrors,
      resources: ctx.resources.length,
      analyzedResources: ctx.resources.filter((r) => ctx.analyzed.has(r.address)).length,
      findings: counts,
      unresolved: unresolved.length,
      notAnalyzed: notAnalyzed.length,
    },
    files: parsed.map((f) => ({ file: f.file, ok: f.ok, diagnostics: f.diagnostics })),
    findings,
    unresolved,
    notAnalyzed,
  };
}

/** Stable JSON export (no timestamps, so reports can be diffed). */
export function toJsonReport(report: TfReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
