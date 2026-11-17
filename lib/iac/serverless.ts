import type { InfraResource } from "@/lib/infra/model";
import { lambdaNeedsVpc, resourcesOfType, targetsOf } from "@/lib/infra/model";
import { attr, blank, block, comment, data, obj, raw, resource, type BodyItem, type HclValue } from "./hcl";
import { managedPolicyArn, output, physicalName, tags, tpl, type GenContext, type SectionFile } from "./context";
import { assumeRoleDoc, relationshipStatements } from "./iam";

/** Placeholder handlers that return a valid ALB/API response. Replace with your code. */
const HANDLER_SOURCE: Record<InfraResource<"lambda">["config"]["runtime"], { file: string; code: string }> = {
  "nodejs20.x": {
    file: "index.js",
    code:
      "exports.handler = async () => ({\n" +
      "  statusCode: 200,\n" +
      "  headers: { 'content-type': 'application/json' },\n" +
      "  body: JSON.stringify({ ok: true, service: process.env.SERVICE_NAME }),\n" +
      "});\n",
  },
  "python3.12": {
    file: "index.py",
    code:
      "import json\nimport os\n\n\n" +
      "def handler(event, context):\n" +
      "    return {\n" +
      "        'statusCode': 200,\n" +
      "        'headers': {'content-type': 'application/json'},\n" +
      "        'body': json.dumps({'ok': True, 'service': os.environ.get('SERVICE_NAME')}),\n" +
      "    }\n",
  },
};

const envName = (tfName: string) => tfName.toUpperCase();

export function generateLambdas(ctx: GenContext): SectionFile | null {
  const fns = resourcesOfType(ctx.model, "lambda");
  if (fns.length === 0) return null;
  ctx.usesArchive = true;

  const items: BodyItem[] = [assumeRoleDoc("lambda_assume", "lambda.amazonaws.com")];

  for (const fn of fns) {
    const n = fn.tfName;
    const c = fn.config;
    const inVpc = lambdaNeedsVpc(ctx.model, fn.id);
    const src = HANDLER_SOURCE[c.runtime];
    const statements = relationshipStatements(ctx, fn);

    const env: [string, HclValue][] = [
      ["SERVICE_NAME", n],
      ["ENVIRONMENT", raw("var.environment")],
    ];
    for (const db of targetsOf(ctx.model, fn.id, "db-client")) {
      env.push([`DB_${envName(db.tfName)}_HOST`, raw(`aws_db_instance.${db.tfName}.address`)]);
      env.push([`DB_${envName(db.tfName)}_SECRET_ARN`, raw(`aws_db_instance.${db.tfName}.master_user_secret[0].secret_arn`)]);
    }
    for (const b of targetsOf(ctx.model, fn.id, "storage-access")) {
      env.push([`BUCKET_${envName(b.tfName)}`, raw(`aws_s3_bucket.${b.tfName}.id`)]);
    }

    items.push(
      comment(`Lambda: ${fn.label.replace(/\n/g, " ")}`),
      block("locals", [], [attr(`${n}_function_name`, physicalName(n, 64))]),
      comment("Placeholder handler packaged at plan time. Replace source with your build artifact."),
      data("archive_file", n, [
        attr("type", "zip"),
        attr("output_path", tpl(`\${path.module}/build/${n}.zip`)),
        blank,
        block("source", [], [attr("filename", src.file), attr("content", src.code)]),
      ]),
      resource("aws_iam_role", `${n}_lambda`, [
        attr("name", raw(`substr("\${local.${n}_function_name}-role", 0, 64)`)),
        attr("assume_role_policy", raw("data.aws_iam_policy_document.lambda_assume.json")),
      ]),
      resource("aws_iam_role_policy_attachment", `${n}_basic`, [
        attr("role", raw(`aws_iam_role.${n}_lambda.name`)),
        attr("policy_arn", managedPolicyArn(ctx, "service-role/AWSLambdaBasicExecutionRole")),
      ])
    );
    if (inVpc) {
      items.push(
        resource("aws_iam_role_policy_attachment", `${n}_vpc`, [
          attr("role", raw(`aws_iam_role.${n}_lambda.name`)),
          attr("policy_arn", managedPolicyArn(ctx, "service-role/AWSLambdaVPCAccessExecutionRole")),
        ])
      );
    }

    if (statements.length) {
      items.push(
        data("aws_iam_policy_document", `${n}_lambda`, statements),
        resource("aws_iam_role_policy", `${n}_lambda`, [
          attr("name", "relationship-access"),
          attr("role", raw(`aws_iam_role.${n}_lambda.id`)),
          attr("policy", raw(`data.aws_iam_policy_document.${n}_lambda.json`)),
        ])
      );
    }

    if (c.extraPermissions.length) {
      items.push(
        comment("User-declared permissions on all resources. Review: the security engine reports these."),
        data("aws_iam_policy_document", `${n}_extra`, [
          block("statement", [], [attr("actions", [...c.extraPermissions]), attr("resources", ["*"])]),
        ]),
        resource("aws_iam_role_policy", `${n}_extra`, [
          attr("name", "extra-permissions"),
          attr("role", raw(`aws_iam_role.${n}_lambda.id`)),
          attr("policy", raw(`data.aws_iam_policy_document.${n}_extra.json`)),
        ])
      );
    }

    const depends = [raw(`aws_cloudwatch_log_group.${n}`), raw(`aws_iam_role_policy_attachment.${n}_basic`)];
    if (inVpc) depends.push(raw(`aws_iam_role_policy_attachment.${n}_vpc`));

    items.push(
      resource("aws_cloudwatch_log_group", n, [
        attr("name", tpl(`/aws/lambda/\${local.${n}_function_name}`)),
        attr("retention_in_days", 14),
      ]),
      resource("aws_lambda_function", n, [
        attr("function_name", raw(`local.${n}_function_name`)),
        attr("role", raw(`aws_iam_role.${n}_lambda.arn`)),
        attr("runtime", c.runtime),
        attr("handler", "index.handler"),
        attr("filename", raw(`data.archive_file.${n}.output_path`)),
        attr("source_code_hash", raw(`data.archive_file.${n}.output_base64sha256`)),
        attr("memory_size", c.memoryMb),
        attr("timeout", c.timeoutSeconds),
        blank,
        inVpc
          ? block("vpc_config", [], [
              attr("subnet_ids", raw("aws_subnet.private[*].id")),
              attr("security_group_ids", [raw(`aws_security_group.${n}.id`)]),
            ])
          : null,
        inVpc ? blank : null,
        block("environment", [], [attr("variables", obj(env))]),
        blank,
        tags(fn.label),
        blank,
        attr("depends_on", depends),
      ])
    );

    ctx.outputs.push(output(`${n}_function_arn`, `ARN of function ${n}`, `aws_lambda_function.${n}.arn`));
  }

  return { file: "lambda.tf", items };
}
