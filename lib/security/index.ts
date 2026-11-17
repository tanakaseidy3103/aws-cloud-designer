import type { AwsNodeData, NetworkSettings } from "@/types";
import type { CanvasEdge, CanvasNode, InfraModel } from "@/lib/infra/model";
import { buildInfraModel } from "@/lib/infra/model";
import { ALL_RULES, type SecurityRule } from "./rules";
import { SEVERITY_ORDER, type SecurityFinding, type SecurityReport, type Severity } from "./types";

export * from "./types";
export { ALL_RULES } from "./rules";

/**
 * Run every deterministic rule against the model.
 * Output order is stable: severity, then rule id, then finding id.
 */
export function analyzeSecurity(model: InfraModel, rules: readonly SecurityRule[] = ALL_RULES): SecurityReport {
  const findings: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    rule.run({
      model,
      emit: (f) => {
        if (seen.has(f.id)) return;
        seen.add(f.id);
        findings.push(f);
      },
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.id.localeCompare(b.id)
  );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const highest = findings[0]?.severity ?? null;

  return { findings, counts, highest };
}

/** Canvas-facing entry point. */
export function analyzeCanvasSecurity(
  nodes: CanvasNode[] | { id: string; data: AwsNodeData }[],
  edges: CanvasEdge[],
  network?: Partial<NetworkSettings>
): SecurityReport {
  return analyzeSecurity(buildInfraModel({ nodes, edges, network }));
}
