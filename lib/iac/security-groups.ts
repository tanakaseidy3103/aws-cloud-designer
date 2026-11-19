import type { AnyInfraResource, InfraResource } from "@/lib/infra/model";
import { isFrontedByCloudFront, lambdaNeedsVpc, resourcesOfType, sourcesOf, targetsOf } from "@/lib/infra/model";
import { RDS_ENGINE_PORT } from "@/lib/infra/config";
import type { IngressRule } from "@/types";
import { attr, blank, comment, data, raw, resource, type BodyItem } from "./hcl";
import { physicalName, tags, type GenContext, type SectionFile } from "./context";

/** Characters AWS accepts in security group (rule) descriptions. */
export function sgDescription(text: string): string {
  return text.replace(/[^a-zA-Z0-9. _\-:/()#,@[\]+=&;{}!$*]/g, "").slice(0, 255).trim() || "Managed by CloudSentinel";
}

const SG_TYPE_LABEL: Record<string, string> = {
  ec2: "EC2 instance",
  rds: "RDS database",
  "load-balancer": "Application Load Balancer",
  lambda: "Lambda function",
};

/** Resources that get their own security group. */
export function hasSecurityGroup(ctx: GenContext, r: AnyInfraResource): boolean {
  return (
    r.type === "ec2" || r.type === "rds" || r.type === "load-balancer" || (r.type === "lambda" && lambdaNeedsVpc(ctx.model, r.id))
  );
}

type Peer = { cidr: string } | { prefixList: string } | { sg: string };

interface RuleSpec {
  name: string;
  direction: "ingress" | "egress";
  sg: string;
  description: string;
  protocol: "tcp" | "udp" | "-1";
  fromPort?: number;
  toPort?: number;
  peer: Peer;
}

function rule(spec: RuleSpec): BodyItem {
  const type = spec.direction === "ingress" ? "aws_vpc_security_group_ingress_rule" : "aws_vpc_security_group_egress_rule";
  const peer =
    "cidr" in spec.peer
      ? spec.peer.cidr.startsWith("var.")
        ? attr("cidr_ipv4", raw(spec.peer.cidr))
        : attr("cidr_ipv4", spec.peer.cidr)
      : "prefixList" in spec.peer
        ? attr("prefix_list_id", raw(spec.peer.prefixList))
        : attr("referenced_security_group_id", raw(`aws_security_group.${spec.peer.sg}.id`));
  const ports = spec.protocol === "-1" ? [] : [attr("from_port", spec.fromPort ?? 0), attr("to_port", spec.toPort ?? 65535)];
  return resource(type, spec.name, [
    attr("security_group_id", raw(`aws_security_group.${spec.sg}.id`)),
    attr("description", sgDescription(spec.description)),
    attr("ip_protocol", spec.protocol),
    ...ports,
    peer,
  ]);
}

function customRules(r: InfraResource<"ec2"> | InfraResource<"rds">): BodyItem[] {
  return r.config.ingressRules.map((ing: IngressRule, i: number) =>
    rule({
      name: `${r.tfName}_custom_${i + 1}`,
      direction: "ingress",
      sg: r.tfName,
      description: ing.description || `User-defined rule ${i + 1}`,
      protocol: ing.protocol,
      fromPort: ing.fromPort,
      toPort: ing.toPort,
      peer: { cidr: ing.cidr.trim() },
    })
  );
}

export function generateSecurityGroups(ctx: GenContext): SectionFile | null {
  const { model } = ctx;
  const withSg = model.resources.filter((r) => hasSecurityGroup(ctx, r));
  if (withSg.length === 0) return null;

  const items: BodyItem[] = [];
  const needsCloudFrontPrefixList = resourcesOfType(model, "load-balancer").some(
    (alb) => !alb.config.internal && isFrontedByCloudFront(model, alb.id)
  );
  if (needsCloudFrontPrefixList) {
    items.push(
      comment("AWS-managed list of CloudFront origin-facing IP ranges."),
      data("aws_ec2_managed_prefix_list", "cloudfront_origin_facing", [attr("name", "com.amazonaws.global.cloudfront.origin-facing")])
    );
  }

  for (const r of withSg) {
    items.push(
      resource("aws_security_group", r.tfName, [
        attr("name", physicalName(r.tfName, 255)),
        attr("description", sgDescription(`${SG_TYPE_LABEL[r.type]} ${r.tfName}`)),
        attr("vpc_id", raw("aws_vpc.main.id")),
        blank,
        tags(r.label),
      ])
    );
  }

  /* ---- Load balancers ------------------------------------------------ */
  for (const alb of resourcesOfType(model, "load-balancer")) {
    const ports = alb.config.httpsEnabled ? [80, 443] : [80];
    if (alb.config.internal) {
      for (const p of ports) {
        items.push(rule({ name: `${alb.tfName}_from_vpc_${p}`, direction: "ingress", sg: alb.tfName, description: `HTTP${p === 443 ? "S" : ""} from inside the VPC`, protocol: "tcp", fromPort: p, toPort: p, peer: { cidr: "var.vpc_cidr" } }));
      }
    } else if (isFrontedByCloudFront(model, alb.id)) {
      // One rule only: the prefix list counts heavily against the SG rule quota.
      const p = alb.config.httpsEnabled ? 443 : 80;
      items.push(rule({ name: `${alb.tfName}_from_cloudfront`, direction: "ingress", sg: alb.tfName, description: "Origin traffic from CloudFront only", protocol: "tcp", fromPort: p, toPort: p, peer: { prefixList: "data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id" } }));
    } else {
      for (const p of ports) {
        items.push(rule({ name: `${alb.tfName}_from_internet_${p}`, direction: "ingress", sg: alb.tfName, description: `HTTP${p === 443 ? "S" : ""} from the internet`, protocol: "tcp", fromPort: p, toPort: p, peer: { cidr: "0.0.0.0/0" } }));
      }
    }
    for (const t of targetsOf(model, alb.id, "lb-target")) {
      if (t.type !== "ec2") continue;
      const port = t.config.appPort;
      items.push(
        rule({ name: `${alb.tfName}_to_${t.tfName}`, direction: "egress", sg: alb.tfName, description: `Forward to ${t.tfName}`, protocol: "tcp", fromPort: port, toPort: port, peer: { sg: t.tfName } }),
        rule({ name: `${t.tfName}_from_${alb.tfName}`, direction: "ingress", sg: t.tfName, description: `Traffic from load balancer ${alb.tfName}`, protocol: "tcp", fromPort: port, toPort: port, peer: { sg: alb.tfName } })
      );
    }
  }

  /* ---- Instances and functions --------------------------------------- */
  for (const r of withSg) {
    if (r.type === "ec2") items.push(...customRules(r));
    if (r.type === "ec2" || r.type === "lambda") {
      items.push(rule({ name: `${r.tfName}_egress_all`, direction: "egress", sg: r.tfName, description: "Outbound to AWS APIs, databases and updates", protocol: "-1", peer: { cidr: "0.0.0.0/0" } }));
    }
  }

  /* ---- Databases ------------------------------------------------------ */
  for (const db of resourcesOfType(model, "rds")) {
    const port = RDS_ENGINE_PORT[db.config.engine];
    for (const client of sourcesOf(model, db.id, "db-client")) {
      if (!hasSecurityGroup(ctx, client)) continue;
      items.push(rule({ name: `${db.tfName}_from_${client.tfName}`, direction: "ingress", sg: db.tfName, description: `${db.config.engine} from ${client.tfName}`, protocol: "tcp", fromPort: port, toPort: port, peer: { sg: client.tfName } }));
    }
    items.push(...customRules(db));
  }

  return { file: "security_groups.tf", items };
}
