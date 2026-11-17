import { describe, expect, it } from "vitest";
import { assertUniqueAddresses, generateTerraformFromModel } from "@/lib/iac/generator";
import { toProjectName } from "@/lib/iac/root";
import { isArmInstanceType } from "@/lib/iac/compute";
import { sgDescription } from "@/lib/iac/security-groups";
import { edge, model, node } from "../fixtures/builders";
import { GENERATOR_FIXTURES } from "../terraform/generated.test";

const all = (files: Record<string, string>) => Object.values(files).join("\n");

describe("generator invariants (all fixtures)", () => {
  for (const [name, m] of Object.entries(GENERATOR_FIXTURES)) {
    describe(name, () => {
      const out = generateTerraformFromModel(m);
      const text = all(out.files);

      it("is deterministic", () => {
        expect(generateTerraformFromModel(m).files).toEqual(out.files);
      });

      it("contains no credentials or hardcoded AWS identifiers", () => {
        expect(text).not.toMatch(/\bpassword\s*=\s*"/i); // a literal password string
        expect(text).not.toMatch(/\bpassword\s*=\s*var\./i); // a password passed through variables/state
        expect(text).not.toMatch(/\bami-[0-9a-f]{8,}\b/);
        expect(text).not.toMatch(/\b(vpc|subnet|sg)-[0-9a-f]{8,}\b/);
        expect(text).not.toMatch(/\b\d{12}\b/); // account ids
        expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
        expect(text).not.toContain("vpc-default");
      });

      it("has unique resource addresses", () => {
        expect(() => assertUniqueAddresses(out.files)).not.toThrow();
      });

      it("points every security finding at a block that exists", () => {
        for (const f of out.security.findings) {
          const [type, name] = f.resource.terraformAddress.split(".");
          const declared = new RegExp(`resource "${type}" "${name}"`).test(text);
          // Settings that are "missing" by definition (no block) are allowed only for these rules:
          const absenceRules = ["CS-S3-002", "CS-S3-003", "CS-LOG-001"];
          if (!absenceRules.includes(f.ruleId)) {
            expect(declared, `${f.id} → ${f.resource.terraformAddress}`).toBe(true);
          }
        }
      });
    });
  }
});

describe("specific generation behavior", () => {
  it("never emits a database password and uses Secrets Manager", () => {
    const { files } = generateTerraformFromModel(model([node("app", "ec2"), node("db", "rds")], [edge("app", "db")]));
    expect(files["database.tf"]).toContain("manage_master_user_password = true");
    expect(files["outputs.tf"]).toContain("master_user_secret[0].secret_arn");
  });

  it("generates one DB ingress rule per client even with duplicate and reversed edges", () => {
    const { files } = generateTerraformFromModel(
      model([node("app", "ec2"), node("db", "rds")], [edge("app", "db", "xy-edge__1"), edge("db", "app", "xy-edge__2")])
    );
    expect(files["security_groups.tf"].match(/"db_from_app"/g)).toHaveLength(1);
  });

  it("restricts a CloudFront-fronted ALB to the CloudFront prefix list", () => {
    const { files } = generateTerraformFromModel(
      model([node("cf", "cloudfront"), node("alb", "load-balancer"), node("e", "ec2")], [edge("cf", "alb"), edge("alb", "e")])
    );
    expect(files["security_groups.tf"]).toContain("com.amazonaws.global.cloudfront.origin-facing");
    expect(files["security_groups.tf"]).not.toContain("alb_from_internet");
  });

  it("emits OAC as a top-level resource and grants the distribution in the bucket policy", () => {
    const { files } = generateTerraformFromModel(model([node("cf", "cloudfront"), node("site", "s3")], [edge("site", "cf")]));
    expect(files["cdn.tf"]).toMatch(/^resource "aws_cloudfront_origin_access_control" "cf"/m);
    expect(files["storage.tf"]).toContain("aws_cloudfront_distribution.cf.arn");
  });

  it("skips and reports a CloudFront distribution without origin", () => {
    const out = generateTerraformFromModel(model([node("cf", "cloudfront")]));
    expect(out.files["cdn.tf"]).toBeUndefined();
    expect(out.skipped[0]).toMatchObject({ resourceId: "cf" });
    expect(out.ready).toBe(false);
  });

  it("does not create a VPC for designs that do not need one", () => {
    const { files } = generateTerraformFromModel(model([node("b", "s3"), node("f", "lambda")]));
    expect(files["network.tf"]).toBeUndefined();
    expect(files["variables.tf"]).not.toContain("vpc_cidr");
  });

  it("puts Lambda into the VPC only when it talks to a database", () => {
    const inVpc = generateTerraformFromModel(model([node("f", "lambda"), node("db", "rds")], [edge("f", "db")]));
    expect(inVpc.files["lambda.tf"]).toContain("vpc_config");
    const outVpc = generateTerraformFromModel(model([node("f", "lambda"), node("b", "s3")], [edge("f", "b")]));
    expect(outVpc.files["lambda.tf"]).not.toContain("vpc_config");
    expect(outVpc.files["lambda.tf"]).toContain('resources = ["${aws_s3_bucket.b.arn}/*"]');
  });

  it("escapes user-provided labels", () => {
    const { files } = generateTerraformFromModel(model([node("b", "s3", { label: 'My "bucket" ${x}' })]));
    expect(files["storage.tf"]).toContain('Name = "My \\"bucket\\" $${x}"');
  });

  it("defaults the region variable to the model region", () => {
    const { files } = generateTerraformFromModel(model([node("b", "s3", { region: "sa-east-1" })]));
    expect(files["variables.tf"]).toContain('default     = "sa-east-1"');
  });

  it("requires a certificate variable when HTTPS is enabled", () => {
    const { files } = generateTerraformFromModel(
      model([node("alb", "load-balancer", { config: { httpsEnabled: true } }), node("e", "ec2")], [edge("alb", "e")])
    );
    expect(files["variables.tf"]).toContain('variable "alb_certificate_arn"');
    expect(files["load_balancer.tf"]).toContain('status_code = "HTTP_301"');
    expect(files["terraform.tfvars.example"]).toContain('alb_certificate_arn = ""');
  });
});

describe("helpers", () => {
  it.each([
    ["3-Tier Web App", "cs-3-tier-web-app"],
    ["Serverless Application", "serverless-applicatio"],
    ["", "cloudsentinel"],
    ["Ação", "acao"],
  ])("toProjectName(%j) = %s", (input, expected) => {
    const out = toProjectName(input);
    expect(out).toMatch(/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/);
    expect(out).toBe(expected.slice(0, 20).replace(/-+$/, ""));
  });

  it("detects Graviton instance families", () => {
    expect(isArmInstanceType("t4g.micro")).toBe(true);
    expect(isArmInstanceType("c7gn.large")).toBe(true);
    expect(isArmInstanceType("m6gd.xlarge")).toBe(true);
    expect(isArmInstanceType("t3.micro")).toBe(false);
    expect(isArmInstanceType("g5.xlarge")).toBe(false);
  });

  it("strips characters AWS rejects in security group descriptions", () => {
    expect(sgDescription('ssh "anywhere" ${oops} é')).toBe("ssh anywhere ${oops}");
    expect(sgDescription("???")).toBe("Managed by CloudSentinel");
  });
});
