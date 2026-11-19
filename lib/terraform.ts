/**
 * Canvas-facing Terraform entry point.
 *
 * The previous string-concatenation generator produced configurations that
 * failed `terraform validate` (see docs/PROJECT_AUDIT.md §3.1). Generation now
 * goes through the normalized infra model in lib/iac.
 */

import type { AwsNodeData, NetworkSettings, TerraformOutput } from "@/types";
import type { CanvasEdge, CanvasNode } from "@/lib/infra/model";
import { buildInfraModel } from "@/lib/infra/model";
import { generateTerraformFromModel } from "@/lib/iac/generator";

export interface GenerateOptions {
  name?: string;
  network?: Partial<NetworkSettings>;
}

export function generateTerraform(
  architectureId: string,
  nodes: CanvasNode[] | { id: string; data: AwsNodeData }[],
  edges: CanvasEdge[],
  options: GenerateOptions = {}
): TerraformOutput {
  const model = buildInfraModel({ name: options.name, nodes, edges, network: options.network });
  const result = generateTerraformFromModel(model);
  return {
    architectureId,
    provider: "aws",
    files: result.files,
    generatedAt: new Date().toISOString(),
    diagnostics: result.diagnostics,
    security: result.security,
    skipped: result.skipped,
    ready: result.ready,
  };
}

export function isTerraformGenerationEnabled(): boolean {
  return true;
}
