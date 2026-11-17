/**
 * Normalized infrastructure model.
 *
 * The canvas (React Flow nodes/edges) is a drawing. Every engine — validation,
 * security, Terraform — consumes this model instead, so they all agree on what
 * the drawing means: resolved configuration, stable Terraform identifiers,
 * normalized edge direction and a single deployment region.
 */

import type { AwsComponentType, AwsNodeData, NetworkSettings, ResourceConfigByType } from "@/types";
import { DEFAULT_REGION } from "@/lib/constants";
import { DEFAULT_INSTANCE_TYPE, resolveConfig, resolveNetworkSettings } from "./config";
import { findRelationshipRule, type RelationshipKind } from "./relationships";

/** Structural subset of React Flow's Node/Edge so engines stay UI-agnostic. */
export interface CanvasNode {
  id: string;
  data: AwsNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface InfraResource<K extends AwsComponentType = AwsComponentType> {
  /** Canvas node id. */
  id: string;
  type: K;
  label: string;
  /** Unique, valid Terraform identifier (letters, digits, underscores). */
  tfName: string;
  region: string;
  instanceType?: string;
  config: ResourceConfigByType[K];
}

export type AnyInfraResource = {
  [K in AwsComponentType]: InfraResource<K>;
}[AwsComponentType];

export interface InfraRelationship {
  /** Canvas edge id. */
  id: string;
  kind: RelationshipKind;
  /** Normalized: always the requesting side. */
  sourceId: string;
  targetId: string;
  reversed: boolean;
}

export type EdgeIssueReason = "self-loop" | "dangling" | "unsupported" | "duplicate";

export interface EdgeIssue {
  edgeId: string;
  sourceId: string;
  targetId: string;
  reason: EdgeIssueReason;
}

export interface InfraModel {
  name: string;
  /** Deployment region (most common node region). */
  region: string;
  /** All distinct regions declared on nodes, sorted. */
  regions: string[];
  resources: AnyInfraResource[];
  relationships: InfraRelationship[];
  edgeIssues: EdgeIssue[];
  network: NetworkSettings;
}

export interface BuildModelInput {
  name?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  network?: Partial<NetworkSettings>;
}

const TF_RESERVED = new Set(["count", "for_each", "depends_on", "lifecycle", "provider", "locals", "module", "var"]);

/** Convert a free-form label into a valid Terraform identifier. */
export function toTerraformIdentifier(label: string, fallback: string): string {
  let id = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `r_${id}`;
  if (TF_RESERVED.has(id)) id = `${id}_res`;
  return id.slice(0, 48).replace(/_+$/g, "");
}

function pickRegion(nodes: CanvasNode[]): { region: string; regions: string[] } {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const r = n.data.region || DEFAULT_REGION;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  if (counts.size === 0) return { region: DEFAULT_REGION, regions: [] };
  let best = "";
  let bestCount = -1;
  // Map preserves insertion order → ties resolve to the first node's region.
  for (const [r, c] of counts) {
    if (c > bestCount) {
      best = r;
      bestCount = c;
    }
  }
  return { region: best, regions: [...counts.keys()].sort() };
}

export function buildInfraModel(input: BuildModelInput): InfraModel {
  const { nodes, edges } = input;
  const { region, regions } = pickRegion(nodes);

  const usedNames = new Map<string, number>();
  const resources: AnyInfraResource[] = nodes.map((node) => {
    const type = node.data.componentType;
    const base = toTerraformIdentifier(node.data.label ?? "", type.replace(/-/g, "_"));
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    const tfName = seen === 0 ? base : `${base}_${seen + 1}`;

    return {
      id: node.id,
      type,
      label: node.data.label || type,
      tfName,
      region: node.data.region || DEFAULT_REGION,
      instanceType: node.data.instanceType?.trim() || DEFAULT_INSTANCE_TYPE[type],
      config: resolveConfig(type, node.data.config as never),
    } as AnyInfraResource;
  });

  // A suffixed name could collide with a later literal label ("web 2" vs "web"+"web").
  const finalNames = new Set<string>();
  for (const r of resources) {
    let name = r.tfName;
    let i = 2;
    while (finalNames.has(name)) name = `${r.tfName}_${i++}`;
    r.tfName = name;
    finalNames.add(name);
  }

  const byId = new Map(resources.map((r) => [r.id, r]));
  const relationships: InfraRelationship[] = [];
  const edgeIssues: EdgeIssue[] = [];
  const seenPairs = new Set<string>();

  for (const edge of edges) {
    const base = { edgeId: edge.id, sourceId: edge.source, targetId: edge.target };
    if (edge.source === edge.target) {
      edgeIssues.push({ ...base, reason: "self-loop" });
      continue;
    }
    const s = byId.get(edge.source);
    const t = byId.get(edge.target);
    if (!s || !t) {
      edgeIssues.push({ ...base, reason: "dangling" });
      continue;
    }
    const match = findRelationshipRule(s.type, t.type);
    if (!match) {
      edgeIssues.push({ ...base, reason: "unsupported" });
      continue;
    }
    const sourceId = match.reversed ? t.id : s.id;
    const targetId = match.reversed ? s.id : t.id;
    const key = `${sourceId}->${targetId}`;
    if (seenPairs.has(key)) {
      edgeIssues.push({ ...base, reason: "duplicate" });
      continue;
    }
    seenPairs.add(key);
    relationships.push({
      id: edge.id,
      kind: match.rule.kind,
      sourceId,
      targetId,
      reversed: match.reversed,
    });
  }

  return {
    name: input.name?.trim() || "Untitled Architecture",
    region,
    regions,
    resources,
    relationships,
    edgeIssues,
    network: resolveNetworkSettings(input.network),
  };
}

/* ------------------------------------------------------------------------ */
/* Query helpers                                                            */
/* ------------------------------------------------------------------------ */

export function resourcesOfType<K extends AwsComponentType>(
  model: InfraModel,
  type: K
): InfraResource<K>[] {
  return model.resources.filter((r) => r.type === type) as unknown as InfraResource<K>[];
}

export function getResource(model: InfraModel, id: string): AnyInfraResource | undefined {
  return model.resources.find((r) => r.id === id);
}

/** Resources this one points to (outgoing, normalized direction). */
export function targetsOf(
  model: InfraModel,
  sourceId: string,
  kind?: RelationshipKind
): AnyInfraResource[] {
  return model.relationships
    .filter((r) => r.sourceId === sourceId && (!kind || r.kind === kind))
    .map((r) => getResource(model, r.targetId))
    .filter((r): r is AnyInfraResource => Boolean(r));
}

/** Resources pointing at this one (incoming, normalized direction). */
export function sourcesOf(
  model: InfraModel,
  targetId: string,
  kind?: RelationshipKind
): AnyInfraResource[] {
  return model.relationships
    .filter((r) => r.targetId === targetId && (!kind || r.kind === kind))
    .map((r) => getResource(model, r.sourceId))
    .filter((r): r is AnyInfraResource => Boolean(r));
}

/** Lambdas that connect to a database must run inside the VPC. */
export function lambdaNeedsVpc(model: InfraModel, lambdaId: string): boolean {
  return targetsOf(model, lambdaId, "db-client").length > 0;
}

/** True when the design contains anything that must live in a VPC. */
export function needsVpc(model: InfraModel): boolean {
  return model.resources.some(
    (r) =>
      r.type === "ec2" ||
      r.type === "rds" ||
      r.type === "load-balancer" ||
      (r.type === "lambda" && lambdaNeedsVpc(model, r.id))
  );
}

/** An ALB whose only clients are CloudFront distributions. */
export function isFrontedByCloudFront(model: InfraModel, albId: string): boolean {
  return sourcesOf(model, albId, "cdn-origin").length > 0;
}
