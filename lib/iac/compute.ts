import { resourcesOfType } from "@/lib/infra/model";
import { attr, blank, block, comment, data, raw, resource, type BodyItem } from "./hcl";
import { managedPolicyArn, output, physicalName, tags, type GenContext, type SectionFile } from "./context";
import { assumeRoleDoc, relationshipStatements } from "./iam";

/** Graviton families (t4g, m7g, c7gn, r6gd, ...) need an arm64 AMI. */
export function isArmInstanceType(instanceType: string): boolean {
  return /^[a-z]+\d+[a-z]*g[a-z]*\./.test(instanceType);
}

function amiData(arch: "x86_64" | "arm64"): BodyItem {
  return data("aws_ami", `al2023_${arch}`, [
    attr("most_recent", true),
    attr("owners", ["amazon"]),
    blank,
    block("filter", [], [attr("name", "name"), attr("values", [`al2023-ami-2023.*-${arch}`])]),
    blank,
    block("filter", [], [attr("name", "architecture"), attr("values", [arch])]),
  ]);
}

/**
 * EC2 instances: latest Amazon Linux 2023 resolved at plan time (no AMI IDs),
 * one IAM role per instance with SSM Session Manager access (no SSH keys
 * needed), IMDSv2 and encrypted gp3 root volume by default.
 */
export function generateCompute(ctx: GenContext): SectionFile | null {
  const instances = resourcesOfType(ctx.model, "ec2");
  if (instances.length === 0) return null;

  const items: BodyItem[] = [];
  const archs = new Set(instances.map((i) => (isArmInstanceType(i.instanceType ?? "") ? "arm64" : "x86_64")));
  for (const arch of ["x86_64", "arm64"] as const) {
    if (archs.has(arch)) {
      ctx.usesAmi.add(arch);
      items.push(amiData(arch));
    }
  }
  items.push(assumeRoleDoc("ec2_assume", "ec2.amazonaws.com"));

  instances.forEach((ec2, index) => {
    const n = ec2.tfName;
    const arch = isArmInstanceType(ec2.instanceType ?? "") ? "arm64" : "x86_64";
    const tier = ec2.config.subnetTier;
    const statements = relationshipStatements(ctx, ec2);

    items.push(
      comment(`EC2: ${ec2.label.replace(/\n/g, " ")}`),
      resource("aws_iam_role", `${n}_ec2`, [
        attr("name", physicalName(n, 64, "-ec2")),
        attr("assume_role_policy", raw("data.aws_iam_policy_document.ec2_assume.json")),
      ]),
      resource("aws_iam_role_policy_attachment", `${n}_ssm`, [
        attr("role", raw(`aws_iam_role.${n}_ec2.name`)),
        attr("policy_arn", managedPolicyArn(ctx, "AmazonSSMManagedInstanceCore")),
      ])
    );

    if (statements.length) {
      items.push(
        data("aws_iam_policy_document", `${n}_ec2`, statements),
        resource("aws_iam_role_policy", `${n}_ec2`, [
          attr("name", "relationship-access"),
          attr("role", raw(`aws_iam_role.${n}_ec2.id`)),
          attr("policy", raw(`data.aws_iam_policy_document.${n}_ec2.json`)),
        ])
      );
    }

    items.push(
      resource("aws_iam_instance_profile", n, [
        attr("name", physicalName(n, 128, "-profile")),
        attr("role", raw(`aws_iam_role.${n}_ec2.name`)),
      ]),
      resource("aws_instance", n, [
        attr("ami", raw(`data.aws_ami.al2023_${arch}.id`)),
        attr("instance_type", ec2.instanceType ?? "t3.micro"),
        attr("subnet_id", raw(`element(aws_subnet.${tier}[*].id, ${index})`)),
        attr("vpc_security_group_ids", [raw(`aws_security_group.${n}.id`)]),
        attr("associate_public_ip_address", tier === "public"),
        attr("iam_instance_profile", raw(`aws_iam_instance_profile.${n}.name`)),
        blank,
        block("metadata_options", [], [
          attr("http_endpoint", "enabled"),
          attr("http_tokens", ec2.config.imdsv2Required ? "required" : "optional"),
          attr("http_put_response_hop_limit", 1),
        ]),
        blank,
        block("root_block_device", [], [
          attr("volume_type", "gp3"),
          attr("volume_size", Math.max(8, Math.round(ec2.config.rootVolumeSizeGb))),
          attr("encrypted", ec2.config.rootVolumeEncrypted),
        ]),
        blank,
        tags(ec2.label),
      ])
    );

    ctx.outputs.push(output(`${n}_private_ip`, `Private IP of ${n}`, `aws_instance.${n}.private_ip`));
    if (tier === "public") ctx.outputs.push(output(`${n}_public_ip`, `Public IP of ${n}`, `aws_instance.${n}.public_ip`));
  });

  return { file: "compute.tf", items };
}
