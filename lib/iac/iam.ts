import type { AnyInfraResource } from "@/lib/infra/model";
import { targetsOf } from "@/lib/infra/model";
import { attr, blank, block, data, raw, type Block } from "./hcl";
import type { GenContext } from "./context";

/**
 * Least-privilege statements derived from relationships:
 *  - storage-access → object read/write on that bucket only
 *  - db-client      → read the database's managed master secret only
 */
export function relationshipStatements(ctx: GenContext, r: AnyInfraResource): Block[] {
  const statements: Block[] = [];
  for (const bucket of targetsOf(ctx.model, r.id, "storage-access")) {
    statements.push(
      block("statement", [], [
        attr("sid", sid(`List${bucket.tfName}`)),
        attr("actions", ["s3:ListBucket"]),
        attr("resources", [raw(`aws_s3_bucket.${bucket.tfName}.arn`)]),
      ]),
      block("statement", [], [
        attr("sid", sid(`Objects${bucket.tfName}`)),
        attr("actions", ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]),
        attr("resources", [raw(`"\${aws_s3_bucket.${bucket.tfName}.arn}/*"`)]),
      ])
    );
  }
  for (const db of targetsOf(ctx.model, r.id, "db-client")) {
    statements.push(
      block("statement", [], [
        attr("sid", sid(`Secret${db.tfName}`)),
        attr("actions", ["secretsmanager:GetSecretValue"]),
        attr("resources", [raw(`aws_db_instance.${db.tfName}.master_user_secret[0].secret_arn`)]),
      ])
    );
  }
  return statements;
}

/** IAM statement ids must be alphanumeric. */
export function sid(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 100) || "Statement";
}

export function assumeRoleDoc(name: string, service: string): Block {
  return data("aws_iam_policy_document", name, [
    block("statement", [], [
      attr("actions", ["sts:AssumeRole"]),
      blank,
      block("principals", [], [attr("type", "Service"), attr("identifiers", [service])]),
    ]),
  ]);
}
