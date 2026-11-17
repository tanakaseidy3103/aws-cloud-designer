import type { InfraResource } from "@/lib/infra/model";
import { resourcesOfType, sourcesOf, targetsOf } from "@/lib/infra/model";
import { attr, blank, block, comment, data, raw, resource, type BodyItem } from "./hcl";
import { output, physicalName, tags, tpl, type GenContext, type SectionFile } from "./context";
import { sid } from "./iam";

/* ======================================================================== */
/* RDS                                                                      */
/* ======================================================================== */

/**
 * RDS instances in dedicated subnet groups. The master password is created
 * and rotated by RDS in AWS Secrets Manager (manage_master_user_password),
 * so no password ever appears in code, variables or Terraform state.
 */
export function generateDatabases(ctx: GenContext): SectionFile | null {
  const dbs = resourcesOfType(ctx.model, "rds");
  if (dbs.length === 0) return null;

  const items: BodyItem[] = [];
  for (const tier of ["private", "public"] as const) {
    const wanted = dbs.some((d) => (tier === "public") === d.config.publiclyAccessible);
    if (!wanted) continue;
    items.push(
      resource("aws_db_subnet_group", tier, [
        attr("name", tpl(`\${local.name_prefix}-${tier}`)),
        attr("subnet_ids", raw(`aws_subnet.${tier}[*].id`)),
        blank,
        tags(tpl(`\${local.name_prefix}-${tier}-db`)),
      ])
    );
  }

  for (const db of dbs) {
    const n = db.tfName;
    const c = db.config;
    items.push(
      comment(`RDS: ${db.label.replace(/\n/g, " ")}`),
      block("locals", [], [attr(`${n}_db_identifier`, physicalName(n, 63))]),
      resource("aws_db_instance", n, [
        attr("identifier", raw(`local.${n}_db_identifier`)),
        attr("engine", c.engine),
        attr("instance_class", db.instanceType ?? "db.t4g.micro"),
        attr("allocated_storage", c.allocatedStorageGb),
        attr("storage_type", "gp3"),
        attr("storage_encrypted", c.storageEncrypted),
        attr("db_name", "app"),
        blank,
        attr("username", raw("var.db_master_username")),
        attr("manage_master_user_password", true),
        blank,
        attr("db_subnet_group_name", raw(`aws_db_subnet_group.${c.publiclyAccessible ? "public" : "private"}.name`)),
        attr("vpc_security_group_ids", [raw(`aws_security_group.${n}.id`)]),
        attr("publicly_accessible", c.publiclyAccessible),
        attr("multi_az", c.multiAz),
        blank,
        attr("backup_retention_period", c.backupRetentionDays),
        attr("copy_tags_to_snapshot", true),
        attr("auto_minor_version_upgrade", true),
        attr("deletion_protection", c.deletionProtection),
        attr("skip_final_snapshot", raw("var.skip_final_snapshot")),
        attr("final_snapshot_identifier", raw(`var.skip_final_snapshot ? null : "\${local.${n}_db_identifier}-final"`)),
        blank,
        tags(db.label),
      ])
    );
    ctx.outputs.push(
      output(`${n}_endpoint`, `Connection endpoint of ${n}`, `aws_db_instance.${n}.address`),
      output(`${n}_master_secret_arn`, `Secrets Manager ARN holding the master credentials of ${n}`, `aws_db_instance.${n}.master_user_secret[0].secret_arn`)
    );
  }

  return { file: "database.tf", items };
}

/* ======================================================================== */
/* S3                                                                       */
/* ======================================================================== */

/** CloudFront distributions whose (primary) origin is this bucket. */
export function cloudFrontReaders(ctx: GenContext, bucket: InfraResource<"s3">) {
  return sourcesOf(ctx.model, bucket.id, "cdn-origin").filter(
    (cf) => targetsOf(ctx.model, cf.id, "cdn-origin")[0]?.id === bucket.id
  );
}

export function generateStorage(ctx: GenContext): SectionFile | null {
  const buckets = resourcesOfType(ctx.model, "s3");
  if (buckets.length === 0) return null;

  const items: BodyItem[] = [];
  for (const b of buckets) {
    const n = b.tfName;
    const c = b.config;
    const bucketRef = raw(`aws_s3_bucket.${n}.id`);

    items.push(
      comment(`S3: ${b.label.replace(/\n/g, " ")}`),
      resource("aws_s3_bucket", n, [
        comment("bucket_prefix keeps names globally unique without random providers."),
        attr("bucket_prefix", raw(`substr("\${local.name_prefix}-${n.replace(/_/g, "-")}-", 0, 37)`)),
        attr("force_destroy", false),
        blank,
        tags(b.label),
      ]),
      resource("aws_s3_bucket_ownership_controls", n, [
        attr("bucket", bucketRef),
        blank,
        block("rule", [], [attr("object_ownership", "BucketOwnerEnforced")]),
      ]),
      resource("aws_s3_bucket_public_access_block", n, [
        attr("bucket", bucketRef),
        attr("block_public_acls", c.blockPublicAccess),
        attr("block_public_policy", c.blockPublicAccess),
        attr("ignore_public_acls", c.blockPublicAccess),
        attr("restrict_public_buckets", c.blockPublicAccess),
      ])
    );

    if (c.encryption !== "none") {
      items.push(
        resource("aws_s3_bucket_server_side_encryption_configuration", n, [
          attr("bucket", bucketRef),
          blank,
          block("rule", [], [
            block("apply_server_side_encryption_by_default", [], [attr("sse_algorithm", c.encryption === "kms" ? "aws:kms" : "AES256")]),
            c.encryption === "kms" ? attr("bucket_key_enabled", true) : null,
          ]),
        ])
      );
    }

    if (c.versioning) {
      items.push(
        resource("aws_s3_bucket_versioning", n, [
          attr("bucket", bucketRef),
          blank,
          block("versioning_configuration", [], [attr("status", "Enabled")]),
        ])
      );
    }

    const statements: BodyItem[] = [
      block("statement", [], [
        attr("sid", "DenyInsecureTransport"),
        attr("effect", "Deny"),
        attr("actions", ["s3:*"]),
        attr("resources", [raw(`aws_s3_bucket.${n}.arn`), raw(`"\${aws_s3_bucket.${n}.arn}/*"`)]),
        blank,
        block("principals", [], [attr("type", "*"), attr("identifiers", ["*"])]),
        blank,
        block("condition", [], [attr("test", "Bool"), attr("variable", "aws:SecureTransport"), attr("values", ["false"])]),
      ]),
    ];
    for (const cf of cloudFrontReaders(ctx, b)) {
      statements.push(
        block("statement", [], [
          attr("sid", sid(`AllowCloudFront${cf.tfName}`)),
          attr("actions", ["s3:GetObject"]),
          attr("resources", [raw(`"\${aws_s3_bucket.${n}.arn}/*"`)]),
          blank,
          block("principals", [], [attr("type", "Service"), attr("identifiers", ["cloudfront.amazonaws.com"])]),
          blank,
          block("condition", [], [
            attr("test", "StringEquals"),
            attr("variable", "AWS:SourceArn"),
            attr("values", [raw(`aws_cloudfront_distribution.${cf.tfName}.arn`)]),
          ]),
        ])
      );
    }

    items.push(
      data("aws_iam_policy_document", `${n}_bucket`, statements),
      resource("aws_s3_bucket_policy", n, [
        attr("bucket", bucketRef),
        attr("policy", raw(`data.aws_iam_policy_document.${n}_bucket.json`)),
        blank,
        attr("depends_on", [raw(`aws_s3_bucket_public_access_block.${n}`)]),
      ])
    );

    ctx.outputs.push(
      output(`${n}_bucket_name`, `Name of bucket ${n}`, `aws_s3_bucket.${n}.id`),
      output(`${n}_bucket_arn`, `ARN of bucket ${n}`, `aws_s3_bucket.${n}.arn`)
    );
  }

  return { file: "storage.tf", items };
}
