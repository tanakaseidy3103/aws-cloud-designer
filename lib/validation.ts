/**
 * Architecture validation.
 *
 * Answers "is this design coherent and generatable?" — topology, relationship
 * semantics and value correctness. Security posture lives in lib/security.
 *
 * Severity contract:
 *  - error   → the Terraform generator cannot produce a correct configuration
 *              for the affected resources (they are skipped or would fail).
 *  - warning → deployable, but almost certainly not what was intended.
 *  - info    → an interpretation or a cost/operational note.
 */

import type { AwsNodeData, NetworkSettings } from "@/types";
import type { CanvasEdge, CanvasNode, InfraModel } from "@/lib/infra/model";
import {
  buildInfraModel,
  getResource,
  sourcesOf,
  targetsOf,
} from "@/lib/infra/model";
import { allowedPartners, RELATIONSHIP_RULES } from "@/lib/infra/relationships";
import { isPortRangeValid, isValidIamAction, isValidIpv4Cidr } from "@/lib/infra/config";
import { getComponentDefinition } from "@/lib/aws-components";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationWarning {
  id: string;
  /** Stable rule code, e.g. ARCH-021. */
  code: string;
  type: ValidationSeverity;
  message: string;
  rule: string;
  affectedNodeIds: string[];
}

export interface Recommendation {
  id: string;
  message: string;
  action: string;
}

export interface ValidationResult {
  isValid: boolean;
  healthScore: number;
  warnings: ValidationWarning[];
  recommendations: Recommendation[];
}

const PENALTY: Record<ValidationSeverity, number> = { error: 15, warning: 5, info: 0 };

const EC2_INSTANCE_TYPE = /^[a-z][a-z0-9-]*\.[a-z0-9]+$/;
const RDS_INSTANCE_CLASS = /^db\.[a-z][a-z0-9-]*\.[a-z0-9]+$/;

function typeLabel(type: string): string {
  return getComponentDefinition(type)?.label ?? type;
}

export function validateModel(model: InfraModel): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const recommendations: Recommendation[] = [];

  const add = (
    code: string,
    type: ValidationSeverity,
    key: string,
    message: string,
    rule: string,
    affectedNodeIds: string[],
    fix?: { message: string; action: string }
  ) => {
    const id = `${code}:${key}`;
    warnings.push({ id, code, type, message, rule, affectedNodeIds });
    if (fix) recommendations.push({ id: `${id}:fix`, ...fix });
  };

  /* ---- Edges ----------------------------------------------------------- */

  for (const issue of model.edgeIssues) {
    const s = getResource(model, issue.sourceId);
    const t = getResource(model, issue.targetId);
    const ids = [issue.sourceId, issue.targetId].filter((id) => getResource(model, id));
    switch (issue.reason) {
      case "unsupported": {
        const partners = allowedPartners(s!.type).map(typeLabel).join(", ") || "nothing";
        add(
          "ARCH-001",
          "error",
          issue.edgeId,
          `Connection "${s!.label}" → "${t!.label}" (${typeLabel(s!.type)} → ${typeLabel(t!.type)}) has no supported meaning.`,
          `Supported relationships: ${RELATIONSHIP_RULES.map((r) => `${r.source}→${r.target}`).join(", ")}.`,
          ids,
          {
            message: `Remove the connection between "${s!.label}" and "${t!.label}".`,
            action: `${typeLabel(s!.type)} can connect to: ${partners}.`,
          }
        );
        break;
      }
      case "self-loop":
        add("ARCH-002", "error", issue.edgeId, `"${s?.label ?? issue.sourceId}" is connected to itself.`,
          "A resource cannot be its own dependency.", ids,
          { message: "Delete the self-referencing connection.", action: "Select the loop edge and press Delete." });
        break;
      case "dangling":
        add("ARCH-003", "warning", issue.edgeId, "A connection points to a resource that no longer exists.",
          "Edges must reference existing resources; this edge is ignored.", ids);
        break;
      case "duplicate":
        add("ARCH-004", "info", issue.edgeId, `Duplicate connection between "${s?.label}" and "${t?.label}" is ignored.`,
          "Each relationship is generated once.", ids);
        break;
    }
  }

  for (const rel of model.relationships.filter((r) => r.reversed)) {
    const s = getResource(model, rel.sourceId)!;
    const t = getResource(model, rel.targetId)!;
    add("ARCH-005", "info", rel.id,
      `Connection drawn from "${t.label}" to "${s.label}" is interpreted as ${typeLabel(s.type)} → ${typeLabel(t.type)} (${rel.kind}).`,
      "Edges are normalized to the direction requests flow.", [s.id, t.id]);
  }

  /* ---- Region & network ----------------------------------------------- */

  if (model.regions.length > 1) {
    add("ARCH-010", "error", "regions",
      `Resources span multiple regions (${model.regions.join(", ")}). Generated Terraform targets a single region: ${model.region}.`,
      "One architecture maps to one AWS provider region. Cross-region designs need separate stacks.",
      model.resources.filter((r) => r.region !== model.region).map((r) => r.id),
      { message: `Set every resource to ${model.region}, or split the design.`, action: "Change the region field in the Properties panel." });
  }

  const net = model.network;
  const vpcPrefix = Number(net.vpcCidr.split("/")[1]);
  if (!isValidIpv4Cidr(net.vpcCidr) || vpcPrefix < 16 || vpcPrefix > 24) {
    add("ARCH-031", "error", "vpc-cidr", `VPC CIDR "${net.vpcCidr}" is invalid.`,
      "The VPC CIDR must be a valid IPv4 block between /16 and /24 so that subnets (+4 bits) fit.", []);
  }
  if (!Number.isInteger(net.azCount) || net.azCount < 2 || net.azCount > 3) {
    add("ARCH-032", "error", "az-count", `Availability zone count ${net.azCount} is not supported.`,
      "ALB and RDS subnet groups need at least two AZs; the generator supports 2 or 3.", []);
  }

  /* ---- Per-resource ---------------------------------------------------- */

  for (const r of model.resources) {
    const connected = model.relationships.some((rel) => rel.sourceId === r.id || rel.targetId === r.id);
    if (!connected) {
      const standaloneOk = r.type === "s3" || r.type === "lambda";
      add("ARCH-011", standaloneOk ? "info" : "warning", r.id,
        `"${r.label}" is not connected to any other resource.`,
        standaloneOk
          ? "Standalone buckets and functions are valid but are generated without any relationships."
          : "Unconnected resources cost money without serving traffic in this design.",
        [r.id],
        standaloneOk ? undefined : { message: `Connect or remove "${r.label}".`, action: `Allowed partners: ${allowedPartners(r.type).map(typeLabel).join(", ")}.` });
    }

    if (r.type === "ec2") {
      if (!EC2_INSTANCE_TYPE.test(r.instanceType ?? "")) {
        add("ARCH-028", "error", r.id, `"${r.label}" has an invalid instance type "${r.instanceType}".`,
          "EC2 instance types look like family.size, e.g. t3.micro.", [r.id]);
      }
      checkIngressRules(r.id, r.label, r.config.ingressRules, add);
      const behindAlb = sourcesOf(model, r.id, "lb-target").length > 0;
      if (behindAlb && r.config.subnetTier === "public") {
        add("ARCH-035", "info", r.id, `"${r.label}" is behind a load balancer but placed in a public subnet.`,
          "Instances behind an ALB do not need public IPs; private subnets reduce exposure.", [r.id],
          { message: `Move "${r.label}" to a private subnet.`, action: "Set Subnet tier to private." });
      }
      if (r.config.subnetTier === "private" && !net.enableNatGateway) {
        add("ARCH-034", "info", r.id, `"${r.label}" is in a private subnet without a NAT Gateway.`,
          "It has no outbound internet access (package updates, SSM Session Manager). S3 is reachable via the generated gateway endpoint.",
          [r.id]);
      }
    }

    if (r.type === "rds") {
      if (!RDS_INSTANCE_CLASS.test(r.instanceType ?? "") || r.instanceType === "db.serverless") {
        add("ARCH-027", "error", r.id, `"${r.label}" has an unsupported instance class "${r.instanceType}".`,
          "RDS instances need a provisioned class such as db.t4g.micro. db.serverless is Aurora-only and not generated.",
          [r.id], { message: `Use a provisioned class for "${r.label}".`, action: "e.g. db.t4g.micro (lowest cost) or db.t4g.medium." });
      }
      checkIngressRules(r.id, r.label, r.config.ingressRules, add);
      if (sourcesOf(model, r.id, "db-client").length === 0) {
        add("ARCH-020", "warning", r.id, `Database "${r.label}" has no clients.`,
          "Connect an EC2 instance or Lambda function so the generator can open the database port to it.", [r.id],
          { message: `Connect an application to "${r.label}".`, action: "Draw an edge from EC2 or Lambda to the database." });
      }
    }

    if (r.type === "lambda") {
      if (targetsOf(model, r.id, "db-client").length > 0 && !net.enableNatGateway) {
        add("ARCH-036", "info", r.id, `"${r.label}" runs in the VPC (it connects to a database) without a NAT Gateway.`,
          "It can reach the database and S3 (gateway endpoint), but not other AWS APIs such as Secrets Manager, where the database credentials are stored.",
          [r.id], { message: `Give "${r.label}" a path to Secrets Manager.`, action: "Enable the NAT Gateway in Network settings, or add a Secrets Manager interface endpoint (both are billed hourly)." });
      }
      const bad = r.config.extraPermissions.filter((a) => !isValidIamAction(a));
      if (bad.length) {
        add("ARCH-030", "error", r.id, `"${r.label}" has invalid IAM actions: ${bad.join(", ")}.`,
          "IAM actions use the form service:Action (wildcards allowed).", [r.id]);
      }
    }

    if (r.type === "load-balancer") {
      const targets = targetsOf(model, r.id, "lb-target");
      const ec2 = targets.filter((t) => t.type === "ec2");
      const fns = targets.filter((t) => t.type === "lambda");
      if (targets.length === 0) {
        add("ARCH-021", "error", r.id, `Load balancer "${r.label}" has no targets.`,
          "An ALB listener must forward to a target group with EC2 instances or one Lambda function.", [r.id],
          { message: `Connect "${r.label}" to EC2 instances or a Lambda function.`, action: "Draw an edge from the ALB to its targets." });
      }
      if (ec2.length && fns.length) {
        add("ARCH-022", "error", r.id, `"${r.label}" mixes EC2 and Lambda targets.`,
          "The generated listener has a single default action; use one target type per ALB.", [r.id, ...targets.map((t) => t.id)]);
      }
      if (fns.length > 1) {
        add("ARCH-023", "error", r.id, `"${r.label}" targets ${fns.length} Lambda functions.`,
          "A Lambda target group can contain only one function.", [r.id, ...fns.map((f) => f.id)]);
      }
    }

    if (r.type === "cloudfront") {
      const origins = targetsOf(model, r.id, "cdn-origin");
      if (origins.length === 0) {
        add("ARCH-024", "error", r.id, `CloudFront "${r.label}" has no origin.`,
          "A distribution needs an S3 bucket or an ALB origin; it is skipped during generation.", [r.id],
          { message: `Connect "${r.label}" to an origin.`, action: "Draw an edge to an S3 bucket (static) or ALB (dynamic)." });
      }
      if (origins.length > 1) {
        add("ARCH-025", "warning", r.id,
          `CloudFront "${r.label}" has ${origins.length} origins; only "${origins[0].label}" is used as the default behavior.`,
          "Additional origins need path-based cache behaviors, which are not generated yet.", [r.id, ...origins.map((o) => o.id)]);
      }
      for (const o of origins) {
        if (o.type === "load-balancer" && o.config.internal) {
          add("ARCH-026", "error", `${r.id}:${o.id}`, `CloudFront "${r.label}" uses internal load balancer "${o.label}" as origin.`,
            "CloudFront reaches custom origins over the internet; an internal ALB is unreachable.", [r.id, o.id],
            { message: `Make "${o.label}" internet-facing or use another origin.`, action: "Uncheck Internal on the load balancer." });
        }
      }
    }
  }

  const score = warnings.reduce((s, w) => s - PENALTY[w.type], 100);
  return {
    isValid: !warnings.some((w) => w.type === "error"),
    healthScore: Math.max(0, Math.min(100, score)),
    warnings,
    recommendations,
  };
}

function checkIngressRules(
  id: string,
  label: string,
  rules: { cidr: string; protocol: string; fromPort: number; toPort: number }[],
  add: (code: string, type: ValidationSeverity, key: string, message: string, rule: string, ids: string[]) => void
) {
  rules.forEach((rule, i) => {
    if (!isValidIpv4Cidr(rule.cidr) || !isPortRangeValid(rule as never)) {
      add("ARCH-029", "error", `${id}:${i}`, `"${label}" ingress rule #${i + 1} is invalid (${rule.protocol} ${rule.fromPort}-${rule.toPort} from ${rule.cidr}).`,
        "Ingress rules need a valid IPv4 CIDR and a port range within 0-65535.", [id]);
    }
  });
}

/** Canvas-facing entry point (kept for the UI and PDF report). */
export function validateArchitecture(
  nodes: CanvasNode[] | { id: string; data: AwsNodeData }[],
  edges: CanvasEdge[],
  network?: Partial<NetworkSettings>
): ValidationResult {
  return validateModel(buildInfraModel({ nodes, edges, network }));
}
