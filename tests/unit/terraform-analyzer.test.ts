import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTerraform, TERRAFORM_RULE_IDS, toJsonReport, type TfFinding, type TfReport } from "@/lib/security/terraform/analyzer";
import { generateTerraformFromModel } from "@/lib/iac/generator";
import { GENERATOR_FIXTURES } from "../fixtures/generator-fixtures";

const ROOT = path.join(__dirname, "..", "fixtures", "terraform");

function load(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(path.join(ROOT, dir)).sort()) out[`${dir}/${f}`] = readFileSync(path.join(ROOT, dir, f), "utf8");
  return out;
}

/** 1-based line of the first line containing `needle` (after `after`, if given). */
function lineOf(src: string, needle: string, after?: string): number {
  const lines = src.split(/\r?\n/);
  const start = after ? lines.findIndex((l) => l.includes(after)) : 0;
  const i = lines.findIndex((l, idx) => idx >= start && l.includes(needle));
  if (i === -1) throw new Error(`"${needle}" not found`);
  return i + 1;
}

const insecure = load("insecure");
const report = analyzeTerraform(insecure);
const find = (ruleId: string, address: string): TfFinding | undefined =>
  report.findings.find((f) => f.ruleId === ruleId && f.resource.address === address);

function expectFinding(ruleId: string, address: string, file: string, needle: string, after?: string) {
  const f = find(ruleId, address);
  expect(f, `${ruleId} on ${address}`).toBeDefined();
  expect(f!.file).toBe(file);
  expect(f!.line).toBe(lineOf(insecure[file], needle, after));
  return f!;
}

describe("finding contract", () => {
  it("every finding has rule id, severity, resource, file, line, evidence, risk and remediation", () => {
    expect(report.findings.length).toBeGreaterThan(15);
    for (const f of report.findings) {
      expect(TERRAFORM_RULE_IDS).toContain(f.ruleId);
      expect(["critical", "high", "medium", "low"]).toContain(f.severity);
      expect(f.resource.address).toMatch(/^(data\.)?aws_[a-z0-9_]+\.[\w-]+$/);
      expect(f.file).toMatch(/^insecure\/.+\.tf$/);
      expect(f.line).toBeGreaterThan(0);
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) {
        expect(e.file).toBeTruthy();
        expect(e.line).toBeGreaterThan(0);
        expect(e.snippet).toBeTruthy();
      }
      expect(f.risk.length).toBeGreaterThan(20);
      expect(f.remediation.length).toBeGreaterThan(10);
      expect(f.references.some((r) => r.startsWith("https://registry.terraform.io/"))).toBe(true);
      expect(f.title).toBeTruthy();
      expect(f.description).toBeTruthy();
    }
  });

  it("is deterministic and exports stable JSON", () => {
    const again = analyzeTerraform(insecure);
    expect(again).toEqual(report);
    expect(toJsonReport(again)).toBe(toJsonReport(report));
    const parsed = JSON.parse(toJsonReport(report)) as TfReport;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary.findings.critical).toBe(report.findings.filter((f) => f.severity === "critical").length);
  });

  it("every emitted rule id is covered by this fixture", () => {
    const emitted = new Set(report.findings.map((f) => f.ruleId));
    for (const id of TERRAFORM_RULE_IDS) expect(emitted, id).toContain(id);
  });
});

describe("S3 public access", () => {
  it("TF-S3-001 public-read ACL", () => {
    const f = expectFinding("TF-S3-001", "aws_s3_bucket_acl.public_site", "insecure/s3.tf", 'acl    = "public-read"');
    expect(f.severity).toBe("critical");
    expect(f.evidence[0]).toMatchObject({ attribute: "acl", value: '"public-read"', snippet: 'acl    = "public-read"' });
  });

  it("TF-S3-002 bucket without a public access block", () => {
    expectFinding("TF-S3-002", "aws_s3_bucket.public_site", "insecure/s3.tf", 'resource "aws_s3_bucket" "public_site"');
    expect(find("TF-S3-002", "aws_s3_bucket.half_blocked")).toBeUndefined(); // it has one
  });

  it("TF-S3-003 public access block with a disabled flag", () => {
    const f = expectFinding("TF-S3-003", "aws_s3_bucket_public_access_block.half_blocked", "insecure/s3.tf", "block_public_policy     = false");
    expect(f.evidence.map((e) => e.attribute)).toEqual(["block_public_policy"]);
  });

  it('TF-S3-004 bucket policy with Principal "*" inside jsonencode', () => {
    const f = expectFinding("TF-S3-004", "aws_s3_bucket_policy.public_site", "insecure/s3.tf", "{", "Statement = [");
    expect(f.evidence.some((e) => e.value === '"s3:GetObject"' && e.line === lineOf(insecure["insecure/s3.tf"], 'Action    = "s3:GetObject"'))).toBe(true);
  });
});

describe("S3 encryption and versioning", () => {
  it("TF-S3-005 no default encryption configuration (low, explains SSE-S3 default)", () => {
    const f = expectFinding("TF-S3-005", "aws_s3_bucket.half_blocked", "insecure/s3.tf", 'resource "aws_s3_bucket" "half_blocked"');
    expect(f.severity).toBe("low");
    expect(f.risk).toMatch(/SSE-S3/);
  });

  it("TF-S3-006 versioning not enabled", () => {
    expectFinding("TF-S3-006", "aws_s3_bucket.public_site", "insecure/s3.tf", 'resource "aws_s3_bucket" "public_site"');
  });
});

describe("security groups with 0.0.0.0/0", () => {
  const file = "insecure/network.tf";

  it("TF-SG-001 SSH in an inline ingress block, reported at the CIDR line", () => {
    const f = expectFinding("TF-SG-001", "aws_security_group.bastion", file, 'cidr_blocks = ["0.0.0.0/0"]');
    expect(f.evidence.map((e) => e.attribute)).toEqual(["ingress[0].cidr_blocks", "ingress[0].from_port", "ingress[0].to_port", "ingress[0].protocol"]);
  });

  it("TF-SG-002 RDP from ::/0", () => {
    expectFinding("TF-SG-002", "aws_security_group.bastion", file, 'ipv6_cidr_blocks = ["::/0"]');
  });

  it("TF-SG-003 all traffic (ip_protocol -1) and nothing more specific for the same rule", () => {
    const f = expectFinding("TF-SG-003", "aws_vpc_security_group_ingress_rule.all_traffic", file, 'cidr_ipv4         = "0.0.0.0/0"', "all_traffic");
    expect(f.severity).toBe("critical");
    expect(find("TF-SG-001", "aws_vpc_security_group_ingress_rule.all_traffic")).toBeUndefined();
  });

  it("TF-SG-004 database port, even when 0.0.0.0/0 is the second CIDR", () => {
    expectFinding("TF-SG-004", "aws_security_group_rule.postgres_public", file, 'cidr_blocks       = ["10.0.0.0/8", "0.0.0.0/0"]');
  });

  it("TF-SG-005 other non-web port; single 443 is not reported", () => {
    expectFinding("TF-SG-005", "aws_vpc_security_group_ingress_rule.app_port", file, 'cidr_ipv4         = "0.0.0.0/0"', "app_port");
    expect(report.findings.filter((f) => f.resource.address === "aws_vpc_security_group_ingress_rule.https_ok")).toEqual([]);
  });

  it("TF-NET-001 subnet auto-assigns public IPs", () => {
    expectFinding("TF-NET-001", "aws_subnet.public", file, "map_public_ip_on_launch = true");
  });
});

describe("RDS", () => {
  const file = "insecure/rds.tf";
  it("TF-RDS-001 publicly accessible", () => {
    expectFinding("TF-RDS-001", "aws_db_instance.legacy", file, "publicly_accessible");
  });
  it("TF-RDS-002 explicit false and provider default (absent)", () => {
    expectFinding("TF-RDS-002", "aws_db_instance.legacy", file, "storage_encrypted");
    const d = expectFinding("TF-RDS-002", "aws_db_instance.defaults", file, 'resource "aws_db_instance" "defaults"');
    expect(d.evidence[0].value).toBe("(not set, defaults to false)");
  });
  it("TF-RDS-003 backups disabled and TF-RDS-004 deletion protection off", () => {
    expectFinding("TF-RDS-003", "aws_db_instance.legacy", file, "backup_retention_period");
    expect(find("TF-RDS-004", "aws_db_instance.defaults")?.severity).toBe("low");
  });
  it("does not leak the database username/password into evidence", () => {
    expect(toJsonReport(report)).not.toMatch(/password\s*=\s*"/);
  });
});

describe("EC2 / IMDSv2 / encryption", () => {
  const file = "insecure/ec2.tf";
  it("TF-EC2-001 http_tokens = optional (high confidence)", () => {
    const f = expectFinding("TF-EC2-001", "aws_instance.imds_v1", file, 'http_tokens   = "optional"');
    expect(f.confidence).toBe("high");
  });
  it("TF-EC2-001 missing metadata_options (medium confidence: AMI may enforce IMDSv2)", () => {
    const f = expectFinding("TF-EC2-001", "aws_instance.no_metadata_options", file, 'resource "aws_instance" "no_metadata_options"');
    expect(f.confidence).toBe("medium");
  });
  it("TF-EC2-002 EBS encryption explicit false and absent", () => {
    expectFinding("TF-EC2-002", "aws_instance.imds_v1", file, "encrypted = false");
    expect(find("TF-EC2-002", "aws_ebs_volume.data")?.confidence).toBe("medium");
  });
  it("TF-EC2-003 public IP and TF-EFS-001 EFS encryption", () => {
    expectFinding("TF-EC2-003", "aws_instance.imds_v1", file, "associate_public_ip_address = true");
    expectFinding("TF-EFS-001", "aws_efs_file_system.shared", file, 'resource "aws_efs_file_system" "shared"');
  });
});

describe("IAM wildcard permissions", () => {
  const file = "insecure/iam.tf";
  it("TF-IAM-001 actions = [\"*\"] in aws_iam_policy_document", () => {
    const f = expectFinding("TF-IAM-001", "data.aws_iam_policy_document.admin_like", file, 'actions   = ["*"]');
    expect(f.severity).toBe("critical");
  });
  it("TF-IAM-002 service wildcard inside jsonencode, at the Action line", () => {
    const f = expectFinding("TF-IAM-002", "aws_iam_policy.s3_wildcard", file, 'Action   = ["s3:*", "ec2:DescribeInstances"]');
    expect(f.evidence[0].value).toBe('"s3:*"');
  });
  it("TF-IAM-003 Allow + NotAction in a heredoc JSON policy", () => {
    expectFinding("TF-IAM-003", "aws_iam_role_policy.not_action", file, "policy = <<-JSON");
  });
  it("TF-IAM-004 AdministratorAccess attachment", () => {
    expectFinding("TF-IAM-004", "aws_iam_role_policy_attachment.admin", file, "AdministratorAccess");
  });
  it("does not double-report the data source through the policy that references it", () => {
    expect(report.findings.filter((f) => f.resource.address === "aws_iam_policy.admin_like")).toEqual([]);
  });
});

describe("hardened configuration", () => {
  const secure = analyzeTerraform(load("secure"));
  it("has no findings, no unresolved checks and is complete", () => {
    expect(secure.findings).toEqual([]);
    expect(secure.unresolved).toEqual([]);
    expect(secure.status).toBe("clean");
    expect(secure.complete).toBe(true);
  });
  it("does not treat the Deny-TLS statement with Principal * as public", () => {
    expect(secure.findings.find((f) => f.ruleId === "TF-S3-004")).toBeUndefined();
  });
});

describe("variables and unresolved expressions", () => {
  const src = load("unresolved");
  const r = analyzeTerraform(src);
  const file = "unresolved/main.tf";
  const u = (ruleId: string, attribute: string) => r.unresolved.find((x) => x.ruleId === ruleId && x.attribute === attribute);

  it("never reports variable-driven values as findings or as secure", () => {
    expect(r.findings).toEqual([]);
    expect(r.status).toBe("incomplete");
    expect(r.complete).toBe(false);
  });

  it("records each undecidable check with the raw expression and line", () => {
    expect(u("TF-RDS-001", "publicly_accessible")).toMatchObject({ file, line: lineOf(src[file], "publicly_accessible"), expression: "var.db_public" });
    expect(u("TF-SG-001", "ingress[0].cidr_blocks")).toMatchObject({ expression: "var.allowed_cidrs", line: lineOf(src[file], "cidr_blocks = var.allowed_cidrs") });
    expect(u("TF-EC2-001", "metadata_options.http_tokens")).toMatchObject({ expression: "var.imds_tokens" });
    expect(u("TF-IAM-001", "statement.Action")).toMatchObject({ expression: "var.admin_actions" });
    expect(u("TF-IAM-004", "policy_arn")).toMatchObject({ expression: "var.policy_arn" });
  });

  it("mentions a literal variable default without using it as the value", () => {
    const x = u("TF-RDS-001", "publicly_accessible")!;
    expect(x.message).toContain('defaults to true');
    expect(x.message).toContain("can override");
  });
});

describe("invalid files and coverage reporting", () => {
  it("reports parse errors with file and line and never claims 'clean'", () => {
    const r = analyzeTerraform(load("invalid"));
    expect(r.files[0]).toMatchObject({ file: "invalid/broken.tf", ok: false });
    expect(r.files[0].diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["unterminated-string", "missing-brace"]));
    expect(r.summary.filesWithErrors).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.status).not.toBe("clean");
  });

  it("an unsupported .tf.json file makes the report incomplete", () => {
    const r = analyzeTerraform({ "main.tf.json": '{"resource":{}}' });
    expect(r.files[0].diagnostics[0].code).toBe("unsupported-file");
    expect(r.status).toBe("incomplete");
  });

  it("lists resource types and modules that no rule checks instead of passing them silently", () => {
    const r = analyzeTerraform({
      "main.tf": ['resource "aws_kms_key" "k" {}', 'module "vpc" {', '  source = "./vpc"', "}"].join("\n"),
    });
    expect(r.notAnalyzed.map((n) => [n.address, n.reason.startsWith("No rule covers") || n.reason.startsWith("Module")])).toEqual([
      ["aws_kms_key.k", true],
      ["module.vpc", true],
    ]);
  });

  it("dynamic ingress blocks are reported as unresolved", () => {
    const r = analyzeTerraform({
      "main.tf": ['resource "aws_security_group" "d" {', '  dynamic "ingress" {', "    for_each = var.rules", "    content {", "      from_port = ingress.value", "    }", "  }", "}"].join("\n"),
    });
    expect(r.unresolved.some((x) => x.ruleId === "TF-SG-001" && x.line === 2)).toBe(true);
  });

  it("redacts secrets in evidence snippets", () => {
    const r = analyzeTerraform({
      "main.tf": [
        'resource "aws_db_instance" "x" {',
        '  password            = "SuperSecret123!"',
        "  publicly_accessible = true",
        "}",
      ].join("\n"),
    });
    expect(toJsonReport(r)).not.toContain("SuperSecret123!");
  });
});

describe("cross-check with CloudSentinel-generated Terraform", () => {
  it("finds the insecure-everything design's exposures at real file/line locations", () => {
    const files = generateTerraformFromModel(GENERATOR_FIXTURES["insecure-everything"]).files;
    const r = analyzeTerraform(files);
    const ids = new Set(r.findings.map((f) => f.ruleId));
    for (const id of ["TF-SG-001", "TF-SG-003", "TF-SG-004", "TF-RDS-001", "TF-RDS-002", "TF-RDS-003", "TF-EC2-001", "TF-EC2-002", "TF-S3-003"]) {
      expect(ids, id).toContain(id);
    }
    const ssh = r.findings.find((f) => f.ruleId === "TF-SG-001")!;
    expect(ssh.file).toBe("security_groups.tf");
    expect(files["security_groups.tf"].split("\n")[ssh.line - 1]).toMatch(/^\s*cidr_ipv4\s+=\s+"0\.0\.0\.0\/0"$/);
  });

  it("finds no High/Critical issue in the default secure designs", () => {
    for (const name of ["app-db-bucket", "serverless-api", "static-site", "https-3-tier"]) {
      const r = analyzeTerraform(generateTerraformFromModel(GENERATOR_FIXTURES[name]).files);
      const serious = r.findings.filter((f) => f.severity === "critical" || f.severity === "high");
      expect(serious, name).toEqual([]);
      expect(r.files.every((f) => f.ok), name).toBe(true);
    }
  });
});

describe("unresolved security group sources", () => {
  const sg = (ports: string) =>
    analyzeTerraform({
      "main.tf": ['resource "aws_security_group" "s" {', "  ingress {", ports, '    protocol    = "tcp"', "    cidr_blocks = var.cidrs", "  }", "}"].join("\n"),
    }).unresolved.map((u) => u.ruleId);

  it("lists only the rules the literal ports can trigger", () => {
    expect(sg("    from_port = 22\n    to_port = 22")).toEqual(["TF-SG-001"]);
    expect(sg("    from_port = 5432\n    to_port = 5432")).toEqual(["TF-SG-004"]);
    expect(sg("    from_port = 443\n    to_port = 443")).toEqual([]);
  });

  it("lists every SG rule when the ports are unresolved too", () => {
    expect(sg("    from_port = var.port\n    to_port = var.port").sort()).toEqual(["TF-SG-001", "TF-SG-002", "TF-SG-003", "TF-SG-004", "TF-SG-005"]);
  });
});
