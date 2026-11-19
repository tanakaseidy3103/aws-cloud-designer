import type { Severity } from "@/lib/security/types";
import type { ParseDiagnostic } from "@/lib/hcl-parser/types";

export type { Severity };

export type TfConfidence = "high" | "medium";

export interface TfResourceRef {
  /** Terraform address, e.g. aws_s3_bucket.logs or data.aws_iam_policy_document.p */
  address: string;
  type: string;
  name: string;
  file: string;
  line: number;
}

export interface TfEvidence {
  file: string;
  line: number;
  /** Dotted path inside the resource, e.g. metadata_options.http_tokens */
  attribute: string;
  /** The configured value as written (literal) or "(not set)". */
  value: string;
  /** The source line, trimmed, with secrets redacted. */
  snippet: string;
}

export interface TfFinding {
  /** Stable: `${ruleId}:${address}:${line}` */
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  description: string;
  resource: TfResourceRef;
  file: string;
  line: number;
  evidence: TfEvidence[];
  risk: string;
  remediation: string;
  references: string[];
  confidence: TfConfidence;
}

/** A check that could not be decided because a value is not a literal. */
export interface TfUnresolvedCheck {
  id: string;
  ruleId: string;
  title: string;
  resource: TfResourceRef;
  file: string;
  line: number;
  attribute: string;
  /** Raw expression text, exactly as written. */
  expression: string;
  message: string;
}

export interface TfNotAnalyzed {
  address: string;
  type: string;
  file: string;
  line: number;
  reason: string;
}

export interface TfFileResult {
  file: string;
  ok: boolean;
  diagnostics: ParseDiagnostic[];
}

export interface TfReport {
  schemaVersion: 1;
  tool: "cloudsentinel-terraform-analyzer";
  /**
   * findings   → at least one finding
   * incomplete → no findings, but some checks could not be decided or files failed to parse
   * clean      → no findings and every applicable check was decided
   */
  status: "findings" | "incomplete" | "clean";
  /** False when any file had parse errors or any check is unresolved. */
  complete: boolean;
  summary: {
    files: number;
    filesWithErrors: number;
    resources: number;
    analyzedResources: number;
    findings: Record<Severity, number>;
    unresolved: number;
    notAnalyzed: number;
  };
  files: TfFileResult[];
  findings: TfFinding[];
  unresolved: TfUnresolvedCheck[];
  notAnalyzed: TfNotAnalyzed[];
}
