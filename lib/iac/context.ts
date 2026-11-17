import type { InfraModel } from "@/lib/infra/model";
import { needsVpc } from "@/lib/infra/model";
import { attr, block, obj, raw, type Block, type BodyItem, type HclValue, type RawExpr } from "./hcl";

/** Mutable state shared by the section generators during one run. */
export interface GenContext {
  model: InfraModel;
  vpc: boolean;
  usesPartition: boolean;
  usesArchive: boolean;
  usesAmi: Set<"x86_64" | "arm64">;
  /** Variables contributed by sections (e.g. certificate ARNs). */
  extraVariables: Block[];
  outputs: Block[];
  /** Human-readable notes for resources that were not generated. */
  skipped: { resourceId: string; reason: string }[];
}

export function createContext(model: InfraModel): GenContext {
  return {
    model,
    vpc: needsVpc(model),
    usesPartition: false,
    usesArchive: false,
    usesAmi: new Set(),
    extraVariables: [],
    outputs: [],
    skipped: [],
  };
}

export interface SectionFile {
  file: string;
  items: BodyItem[];
}

/** tf identifier → AWS-style name fragment ("web_server" → "web-server"). */
export const dashed = (tfName: string): string => tfName.replace(/_/g, "-");

/**
 * Physical AWS name: "<project>-<env>-<resource>", truncated to `max`
 * characters without a trailing hyphen.
 */
export function physicalName(tfName: string, max: number, suffix = ""): RawExpr {
  const inner = `"\${local.name_prefix}-${dashed(tfName)}"`;
  if (!suffix) return raw(`trimsuffix(substr(${inner}, 0, ${max}), "-")`);
  return raw(`"\${trimsuffix(substr(${inner}, 0, ${max - suffix.length}), "-")}${suffix}"`);
}

/** Interpolated string expression, e.g. tpl("${local.name_prefix}-vpc"). */
export const tpl = (template: string): RawExpr => raw(`"${template}"`);

export const tags = (name: HclValue, extra: Record<string, HclValue> = {}) => attr("tags", obj({ Name: name, ...extra }));

export function output(name: string, description: string, value: string, sensitive = false): Block {
  return block("output", [name], [
    attr("description", description),
    attr("value", raw(value)),
    sensitive ? attr("sensitive", true) : null,
  ]);
}

export function variable(
  name: string,
  type: string,
  description: string,
  defaultValue?: HclValue,
  extra: BodyItem[] = []
): Block {
  return block("variable", [name], [
    attr("type", raw(type)),
    attr("description", description),
    defaultValue !== undefined ? attr("default", defaultValue) : null,
    ...extra,
  ]);
}

/** Managed policy ARN that works in every partition (aws, aws-cn, aws-us-gov). */
export function managedPolicyArn(ctx: GenContext, path: string): RawExpr {
  ctx.usesPartition = true;
  return tpl(`arn:\${data.aws_partition.current.partition}:iam::aws:policy/${path}`);
}
