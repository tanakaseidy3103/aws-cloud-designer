import { attr, blank, block, comment, data, raw, resource } from "./hcl";
import { output, physicalName, tags, tpl, type GenContext, type SectionFile } from "./context";

/**
 * One VPC per architecture:
 *  - var.az_count public and private subnets (/20 each in a /16)
 *  - Internet Gateway + public route table
 *  - private route table, optional single NAT Gateway (off by default: billed hourly)
 *  - free S3 gateway endpoint so private workloads reach S3 without NAT
 *  - default security group locked down (no rules)
 *  - optional VPC Flow Logs to CloudWatch Logs
 */
export function generateNetwork(ctx: GenContext): SectionFile | null {
  if (!ctx.vpc) return null;
  ctx.outputs.push(
    output("vpc_id", "ID of the VPC", "aws_vpc.main.id"),
    output("public_subnet_ids", "Public subnet IDs", "aws_subnet.public[*].id"),
    output("private_subnet_ids", "Private subnet IDs", "aws_subnet.private[*].id")
  );

  return {
    file: "network.tf",
    items: [
      data("aws_availability_zones", "available", [attr("state", "available")]),

      block("locals", [], [attr("azs", raw("slice(data.aws_availability_zones.available.names, 0, var.az_count)"))]),

      resource("aws_vpc", "main", [
        attr("cidr_block", raw("var.vpc_cidr")),
        attr("enable_dns_support", true),
        attr("enable_dns_hostnames", true),
        blank,
        tags(tpl("${local.name_prefix}-vpc")),
      ]),

      comment("Remove all rules from the default security group so nothing uses it by accident."),
      resource("aws_default_security_group", "default", [attr("vpc_id", raw("aws_vpc.main.id"))]),

      resource("aws_internet_gateway", "main", [
        attr("vpc_id", raw("aws_vpc.main.id")),
        blank,
        tags(tpl("${local.name_prefix}-igw")),
      ]),

      resource("aws_subnet", "public", [
        attr("count", raw("var.az_count")),
        blank,
        attr("vpc_id", raw("aws_vpc.main.id")),
        attr("cidr_block", raw("cidrsubnet(var.vpc_cidr, 4, count.index)")),
        attr("availability_zone", raw("local.azs[count.index]")),
        attr("map_public_ip_on_launch", false),
        blank,
        tags(tpl("${local.name_prefix}-public-${local.azs[count.index]}"), { Tier: "public" }),
      ]),

      resource("aws_subnet", "private", [
        attr("count", raw("var.az_count")),
        blank,
        attr("vpc_id", raw("aws_vpc.main.id")),
        attr("cidr_block", raw("cidrsubnet(var.vpc_cidr, 4, count.index + 8)")),
        attr("availability_zone", raw("local.azs[count.index]")),
        blank,
        tags(tpl("${local.name_prefix}-private-${local.azs[count.index]}"), { Tier: "private" }),
      ]),

      resource("aws_route_table", "public", [
        attr("vpc_id", raw("aws_vpc.main.id")),
        blank,
        tags(tpl("${local.name_prefix}-public")),
      ]),

      resource("aws_route", "public_internet", [
        attr("route_table_id", raw("aws_route_table.public.id")),
        attr("destination_cidr_block", "0.0.0.0/0"),
        attr("gateway_id", raw("aws_internet_gateway.main.id")),
      ]),

      resource("aws_route_table_association", "public", [
        attr("count", raw("var.az_count")),
        blank,
        attr("subnet_id", raw("aws_subnet.public[count.index].id")),
        attr("route_table_id", raw("aws_route_table.public.id")),
      ]),

      resource("aws_route_table", "private", [
        attr("vpc_id", raw("aws_vpc.main.id")),
        blank,
        tags(tpl("${local.name_prefix}-private")),
      ]),

      resource("aws_route_table_association", "private", [
        attr("count", raw("var.az_count")),
        blank,
        attr("subnet_id", raw("aws_subnet.private[count.index].id")),
        attr("route_table_id", raw("aws_route_table.private.id")),
      ]),

      comment("NAT Gateway: billed per hour and per GB processed. Disabled unless enable_nat_gateway = true."),
      resource("aws_eip", "nat", [
        attr("count", raw("var.enable_nat_gateway ? 1 : 0")),
        blank,
        attr("domain", "vpc"),
        blank,
        tags(tpl("${local.name_prefix}-nat")),
      ]),

      resource("aws_nat_gateway", "main", [
        attr("count", raw("var.enable_nat_gateway ? 1 : 0")),
        blank,
        attr("allocation_id", raw("aws_eip.nat[0].id")),
        attr("subnet_id", raw("aws_subnet.public[0].id")),
        blank,
        tags(tpl("${local.name_prefix}-nat")),
        blank,
        attr("depends_on", [raw("aws_internet_gateway.main")]),
      ]),

      resource("aws_route", "private_nat", [
        attr("count", raw("var.enable_nat_gateway ? 1 : 0")),
        blank,
        attr("route_table_id", raw("aws_route_table.private.id")),
        attr("destination_cidr_block", "0.0.0.0/0"),
        attr("nat_gateway_id", raw("aws_nat_gateway.main[0].id")),
      ]),

      comment("Gateway endpoints are free; private subnets reach S3 without a NAT Gateway."),
      resource("aws_vpc_endpoint", "s3", [
        attr("vpc_id", raw("aws_vpc.main.id")),
        attr("service_name", tpl("com.amazonaws.${var.aws_region}.s3")),
        attr("vpc_endpoint_type", "Gateway"),
        attr("route_table_ids", [raw("aws_route_table.private.id")]),
        blank,
        tags(tpl("${local.name_prefix}-s3-endpoint")),
      ]),

      comment("VPC Flow Logs (CloudWatch Logs ingestion and storage are billed)."),
      resource("aws_cloudwatch_log_group", "flow_logs", [
        attr("count", raw("var.enable_flow_logs ? 1 : 0")),
        blank,
        attr("name", tpl("/vpc/${local.name_prefix}/flow-logs")),
        attr("retention_in_days", 30),
      ]),

      data("aws_iam_policy_document", "flow_logs_assume", [
        block("statement", [], [
          attr("actions", ["sts:AssumeRole"]),
          blank,
          block("principals", [], [attr("type", "Service"), attr("identifiers", ["vpc-flow-logs.amazonaws.com"])]),
        ]),
      ]),

      resource("aws_iam_role", "flow_logs", [
        attr("count", raw("var.enable_flow_logs ? 1 : 0")),
        blank,
        attr("name", physicalName("flow_logs", 64)),
        attr("assume_role_policy", raw("data.aws_iam_policy_document.flow_logs_assume.json")),
      ]),

      data("aws_iam_policy_document", "flow_logs", [
        attr("count", raw("var.enable_flow_logs ? 1 : 0")),
        blank,
        block("statement", [], [
          attr("actions", ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"]),
          attr("resources", [tpl("${aws_cloudwatch_log_group.flow_logs[0].arn}:*")]),
        ]),
      ]),

      resource("aws_iam_role_policy", "flow_logs", [
        attr("count", raw("var.enable_flow_logs ? 1 : 0")),
        blank,
        attr("name", "flow-logs-to-cloudwatch"),
        attr("role", raw("aws_iam_role.flow_logs[0].id")),
        attr("policy", raw("data.aws_iam_policy_document.flow_logs[0].json")),
      ]),

      resource("aws_flow_log", "main", [
        attr("count", raw("var.enable_flow_logs ? 1 : 0")),
        blank,
        attr("vpc_id", raw("aws_vpc.main.id")),
        attr("traffic_type", "ALL"),
        attr("log_destination", raw("aws_cloudwatch_log_group.flow_logs[0].arn")),
        attr("iam_role_arn", raw("aws_iam_role.flow_logs[0].arn")),
      ]),
    ],
  };
}
