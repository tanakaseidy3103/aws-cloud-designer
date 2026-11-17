import type { AwsComponentType, AwsNodeData, NetworkSettings } from "@/types";
import type { CanvasEdge, CanvasNode } from "@/lib/infra/model";
import { buildInfraModel } from "@/lib/infra/model";

export function node(
  id: string,
  componentType: AwsComponentType,
  extra: Partial<AwsNodeData> = {}
): CanvasNode {
  return { id, data: { componentType, label: extra.label ?? id, region: "us-east-1", ...extra } };
}

export function edge(source: string, target: string, id = `xy-edge__${source}-${target}`): CanvasEdge {
  return { id, source, target };
}

export function model(
  nodes: CanvasNode[],
  edges: CanvasEdge[] = [],
  network?: Partial<NetworkSettings>,
  name = "Test Architecture"
) {
  return buildInfraModel({ name, nodes, edges, network });
}
