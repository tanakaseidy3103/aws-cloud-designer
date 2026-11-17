import { attr, blank, block, comment, data, obj, raw, renderFile, type BodyItem } from "./hcl";
import { variable, type GenContext } from "./context";

/** Turn an architecture name into a valid `project_name` default. */
export function toProjectName(name: string): string {
  let p = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(p)) p = `cs-${p}`;
  p = p.slice(0, 20).replace(/-+$/g, "");
  return p.length >= 3 ? p : "cloudsentinel";
}

export function providersFile(ctx: GenContext): BodyItem[] {
  const providers: [string, ReturnType<typeof obj>][] = [
    ["aws", obj({ source: "hashicorp/aws", version: "~> 5.0" })],
  ];
  if (ctx.usesArchive) providers.push(["archive", obj({ source: "hashicorp/archive", version: "~> 2.4" })]);

  return [
    block("terraform", [], [
      attr("required_version", ">= 1.5.0"),
      blank,
      block("required_providers", [], providers.map(([k, v]) => attr(k, v))),
    ]),
    block("provider", ["aws"], [
      attr("region", raw("var.aws_region")),
      blank,
      block("default_tags", [], [
        attr("tags", obj({ Project: raw("var.project_name"), Environment: raw("var.environment"), ManagedBy: "CloudSentinel" })),
      ]),
    ]),
  ];
}

export function mainFile(ctx: GenContext): BodyItem[] {
  return [
    block("locals", [], [attr("name_prefix", raw('"${var.project_name}-${var.environment}"'))]),
    ctx.usesPartition ? data("aws_partition", "current", []) : null,
  ].filter(Boolean) as BodyItem[];
}

export function variablesFile(ctx: GenContext): BodyItem[] {
  const { model } = ctx;
  const items: BodyItem[] = [
    variable("aws_region", "string", "AWS region to deploy into.", model.region, [
      block("validation", [], [
        attr("condition", raw('can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.aws_region))')),
        attr("error_message", "aws_region must look like us-east-1."),
      ]),
    ]),
    variable("project_name", "string", "Short project name used as the prefix of every resource name.", toProjectName(model.name), [
      block("validation", [], [
        attr("condition", raw('can(regex("^[a-z][a-z0-9-]{1,18}[a-z0-9]$", var.project_name)) && !strcontains(var.project_name, "--")')),
        attr("error_message", "project_name must be 3-20 lowercase letters, digits or single hyphens, starting with a letter."),
      ]),
    ]),
    variable("environment", "string", "Deployment environment name.", "dev", [
      block("validation", [], [
        attr("condition", raw('can(regex("^[a-z][a-z0-9]{0,9}$", var.environment))')),
        attr("error_message", "environment must be 1-10 lowercase letters or digits, starting with a letter."),
      ]),
    ]),
  ];

  if (ctx.vpc) {
    items.push(
      variable("vpc_cidr", "string", "IPv4 CIDR of the VPC (/16 to /24).", model.network.vpcCidr, [
        block("validation", [], [
          attr("condition", raw("can(cidrhost(var.vpc_cidr, 0)) && tonumber(split(\"/\", var.vpc_cidr)[1]) >= 16 && tonumber(split(\"/\", var.vpc_cidr)[1]) <= 24")),
          attr("error_message", "vpc_cidr must be a valid IPv4 CIDR between /16 and /24."),
        ]),
      ]),
      variable("az_count", "number", "Number of availability zones (public + private subnet in each).", model.network.azCount, [
        block("validation", [], [
          attr("condition", raw("var.az_count >= 2 && var.az_count <= 3")),
          attr("error_message", "az_count must be 2 or 3."),
        ]),
      ]),
      variable("enable_nat_gateway", "bool", "Create a NAT Gateway for outbound internet access from private subnets (billed hourly).", model.network.enableNatGateway),
      variable("enable_flow_logs", "bool", "Send VPC Flow Logs to CloudWatch Logs.", model.network.enableFlowLogs)
    );
  }

  if (model.resources.some((r) => r.type === "rds")) {
    items.push(
      variable("db_master_username", "string", "Master username for RDS instances. The password is generated and stored in AWS Secrets Manager.", "app_admin", [
        block("validation", [], [
          attr("condition", raw('can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.db_master_username)) && !contains(["admin", "rdsadmin", "postgres", "root"], lower(var.db_master_username))')),
          attr("error_message", "db_master_username must be 1-16 alphanumeric characters starting with a letter and must not be a reserved name."),
        ]),
      ]),
      variable("skip_final_snapshot", "bool", "Skip the final snapshot on destroy. Keep true for disposable labs; set false for data you need.", true)
    );
  }

  items.push(...ctx.extraVariables);
  return items;
}

export function tfvarsExample(ctx: GenContext): string {
  const lines = [
    "# Copy to terraform.tfvars and adjust. Never commit secrets: none are required here.",
    `aws_region   = "${ctx.model.region}"`,
    `project_name = "${toProjectName(ctx.model.name)}"`,
    'environment  = "dev"',
  ];
  if (ctx.vpc) {
    lines.push("", "# Cost control: a NAT Gateway is billed per hour even when idle.", "enable_nat_gateway = false", `enable_flow_logs   = ${ctx.model.network.enableFlowLogs}`);
  }
  for (const v of ctx.extraVariables) {
    if (!v.body.some((i) => i.kind === "attr" && i.key === "default")) {
      lines.push("", `# Required: ${String((v.body.find((i) => i.kind === "attr" && i.key === "description") as { value: string } | undefined)?.value ?? "")}`, `${v.labels[0]} = ""`);
    }
  }
  return lines.join("\n") + "\n";
}

export function outputsFile(ctx: GenContext): BodyItem[] {
  return ctx.outputs.length ? ctx.outputs : [comment("No outputs for this architecture.")];
}

export { renderFile };
