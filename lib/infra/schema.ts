/**
 * Runtime validation for architecture documents coming from outside the
 * process: API request bodies and imported JSON files. Unknown properties are
 * dropped; anything malformed is rejected with a path-specific message.
 */

import type { AwsComponentType, AwsNodeData, IngressRule, NetworkSettings } from "@/types";
import { AWS_COMPONENT_MAP } from "@/lib/aws-components";
import { DEFAULT_CONFIG } from "./config";

export const LIMITS = { nodes: 200, edges: 500, label: 200, description: 2000, rules: 50, permissions: 50 } as const;

export interface ArchitectureDocument {
  name: string;
  nodes: { id: string; type?: string; position: { x: number; y: number }; data: AwsNodeData }[];
  edges: { id: string; source: string; target: string }[];
  network?: Partial<NetworkSettings>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class SchemaError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, path: string, max: number, optional = false): string | undefined {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw new SchemaError(`${path} is required`);
  }
  if (typeof v !== "string") throw new SchemaError(`${path} must be a string`);
  if (v.length > max) throw new SchemaError(`${path} exceeds ${max} characters`);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SchemaError(`${path} must be a finite number`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new SchemaError(`${path} must be a boolean`);
  return v;
}

function ingressRules(v: unknown, path: string): IngressRule[] {
  if (!Array.isArray(v)) throw new SchemaError(`${path} must be an array`);
  if (v.length > LIMITS.rules) throw new SchemaError(`${path} exceeds ${LIMITS.rules} rules`);
  return v.map((r, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(r)) throw new SchemaError(`${p} must be an object`);
    const protocol = r.protocol;
    if (protocol !== "tcp" && protocol !== "udp" && protocol !== "-1") throw new SchemaError(`${p}.protocol must be tcp, udp or -1`);
    return {
      protocol,
      fromPort: num(r.fromPort, `${p}.fromPort`),
      toPort: num(r.toPort, `${p}.toPort`),
      cidr: str(r.cidr, `${p}.cidr`, 64)!,
      description: str(r.description, `${p}.description`, 255, true),
    };
  });
}

/**
 * Validate a node config against the shape of the type's defaults: every
 * known key must have the same JS type as its default. Values are range
 * checked later by architecture validation.
 */
function config(type: AwsComponentType, v: unknown, path: string): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw new SchemaError(`${path} must be an object`);
  const defaults = DEFAULT_CONFIG[type] as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(defaults)) {
    const value = v[key];
    if (value === undefined) continue;
    const p = `${path}.${key}`;
    if (key === "ingressRules") out[key] = ingressRules(value, p);
    else if (key === "extraPermissions") {
      if (!Array.isArray(value) || value.length > LIMITS.permissions) throw new SchemaError(`${p} must be an array of at most ${LIMITS.permissions} strings`);
      out[key] = value.map((a, i) => str(a, `${p}[${i}]`, 128)!);
    } else if (typeof def === "boolean") out[key] = bool(value, p);
    else if (typeof def === "number") out[key] = num(value, p);
    else if (typeof def === "string") out[key] = str(value, p, 64);
  }
  return out;
}

function network(v: unknown): Partial<NetworkSettings> | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw new SchemaError("network must be an object");
  const out: Partial<NetworkSettings> = {};
  if (v.vpcCidr !== undefined) out.vpcCidr = str(v.vpcCidr, "network.vpcCidr", 32);
  if (v.azCount !== undefined) out.azCount = num(v.azCount, "network.azCount");
  if (v.enableNatGateway !== undefined) out.enableNatGateway = bool(v.enableNatGateway, "network.enableNatGateway");
  if (v.enableFlowLogs !== undefined) out.enableFlowLogs = bool(v.enableFlowLogs, "network.enableFlowLogs");
  return out;
}

export function parseArchitectureDocument(input: unknown): ParseResult<ArchitectureDocument> {
  try {
    if (!isObj(input)) throw new SchemaError("document must be an object");
    if (!Array.isArray(input.nodes)) throw new SchemaError("nodes must be an array");
    if (!Array.isArray(input.edges)) throw new SchemaError("edges must be an array");
    if (input.nodes.length > LIMITS.nodes) throw new SchemaError(`nodes exceeds ${LIMITS.nodes}`);
    if (input.edges.length > LIMITS.edges) throw new SchemaError(`edges exceeds ${LIMITS.edges}`);

    const ids = new Set<string>();
    const nodes = input.nodes.map((raw, i) => {
      const p = `nodes[${i}]`;
      if (!isObj(raw) || !isObj(raw.data)) throw new SchemaError(`${p} must be an object with data`);
      const id = str(raw.id, `${p}.id`, 128)!;
      if (ids.has(id)) throw new SchemaError(`${p}.id "${id}" is duplicated`);
      ids.add(id);
      const componentType = raw.data.componentType;
      if (typeof componentType !== "string" || !AWS_COMPONENT_MAP[componentType]) {
        throw new SchemaError(`${p}.data.componentType "${String(componentType)}" is not supported`);
      }
      const type = componentType as AwsComponentType;
      const position = isObj(raw.position)
        ? { x: num(raw.position.x, `${p}.position.x`), y: num(raw.position.y, `${p}.position.y`) }
        : { x: 0, y: 0 };
      const data: AwsNodeData = {
        componentType: type,
        label: str(raw.data.label, `${p}.data.label`, LIMITS.label)!,
        description: str(raw.data.description, `${p}.data.description`, LIMITS.description, true),
        instanceType: str(raw.data.instanceType, `${p}.data.instanceType`, 64, true),
        region: str(raw.data.region, `${p}.data.region`, 32, true),
      };
      const cfg = config(type, raw.data.config, `${p}.data.config`);
      if (cfg) data.config = cfg as AwsNodeData["config"];
      for (const k of Object.keys(data) as (keyof AwsNodeData)[]) if (data[k] === undefined) delete data[k];
      return { id, type: AWS_COMPONENT_MAP[type].nodeType, position, data };
    });

    const edges = input.edges.map((raw, i) => {
      const p = `edges[${i}]`;
      if (!isObj(raw)) throw new SchemaError(`${p} must be an object`);
      return {
        id: str(raw.id, `${p}.id`, 256)!,
        source: str(raw.source, `${p}.source`, 128)!,
        target: str(raw.target, `${p}.target`, 128)!,
      };
    });

    return {
      ok: true,
      value: {
        name: str(input.name, "name", LIMITS.label, true) ?? "Imported Architecture",
        nodes,
        edges,
        network: network(input.network),
      },
    };
  } catch (err) {
    if (err instanceof SchemaError) return { ok: false, error: err.message };
    throw err;
  }
}
