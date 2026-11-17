import type { AwsComponentType } from "@/types";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * How sure the rule is that the risk materializes:
 *  - high:   follows directly from the declared configuration.
 *  - medium: depends on something outside the design (object ACLs, runtime traffic, ...).
 *  - low:    heuristic.
 */
export type Confidence = "high" | "medium" | "low";

export type SecurityCategory = "network" | "data-protection" | "identity" | "logging" | "transport";

export interface Evidence {
  /** Path inside the design, e.g. `config.ingressRules[0]`. */
  path: string;
  /** The exact value that triggered the rule. */
  value: unknown;
  description: string;
}

export interface FindingResource {
  /** Canvas node id, or "network" for architecture-wide settings. */
  id: string;
  type: AwsComponentType | "vpc";
  label: string;
  /** Terraform address of the block that implements the setting. */
  terraformAddress: string;
}

export interface SecurityFinding {
  /** Stable across runs: `${ruleId}:${resource}:${discriminator}`. */
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  category: SecurityCategory;
  resource: FindingResource;
  evidence: Evidence[];
  risk: string;
  remediation: string;
  /** Where to change it in CloudSentinel (Properties panel field). */
  configReference: string;
  confidence: Confidence;
  /** Public benchmarks the rule maps to, e.g. "CIS AWS 5.2". */
  references: string[];
}

export interface SecurityReport {
  findings: SecurityFinding[];
  counts: Record<Severity, number>;
  /** Highest severity present, or null when there are no findings. */
  highest: Severity | null;
}
