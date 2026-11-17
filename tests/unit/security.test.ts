import { describe, expect, it } from "vitest";
import { analyzeSecurity, ALL_RULES, SEVERITY_ORDER } from "@/lib/security";
import type { IngressRule } from "@/types";
import { edge, model, node } from "../fixtures/builders";

const ssh: IngressRule = { protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0", description: "ssh" };
const rdp: IngressRule = { protocol: "tcp", fromPort: 3389, toPort: 3389, cidr: "0.0.0.0/0" };

function findingsFor(m: ReturnType<typeof model>, ruleId: string) {
  return analyzeSecurity(m).findings.filter((f) => f.ruleId === ruleId);
}

describe("security engine: secure defaults", () => {
  it("a default 3-tier design has no finding above Medium", () => {
    const m = model(
      [node("cf", "cloudfront"), node("alb", "load-balancer"), node("app", "ec2"), node("db", "rds"), node("b", "s3")],
      [edge("cf", "alb"), edge("alb", "app"), edge("app", "db")]
    );
    const report = analyzeSecurity(m);
    expect(report.counts.critical).toBe(0);
    expect(report.counts.high).toBe(0);
  });

  it("every rule has a unique id", () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Scenario 1: SSH exposed to the internet", () => {
  const m = model([node("bastion", "ec2", { label: "Bastion", config: { subnetTier: "public", ingressRules: [ssh] } })]);

  it("detects the exposure with evidence and remediation", () => {
    const [f] = findingsFor(m, "CS-NET-001");
    expect(f).toBeDefined();
    expect(f.severity).toBe("high");
    expect(f.confidence).toBe("high");
    expect(f.resource.terraformAddress).toBe("aws_vpc_security_group_ingress_rule.bastion_custom_1");
    expect(f.evidence[0]).toMatchObject({ path: "config.ingressRules[0]", value: ssh });
    expect(f.remediation).toMatch(/Session Manager|restrict/i);
    expect(f.references).toContain("AWS FSBP EC2.13");
    expect(f.id).toBe("CS-NET-001:bastion:0");
  });

  it("lowers severity and confidence when the instance has no public IP", () => {
    const priv = model([node("x", "ec2", { config: { subnetTier: "private", ingressRules: [ssh] } })]);
    const [f] = findingsFor(priv, "CS-NET-001");
    expect(f.severity).toBe("medium");
    expect(f.confidence).toBe("medium");
  });

  it("does not flag SSH restricted to a known CIDR", () => {
    const ok = model([node("x", "ec2", { config: { subnetTier: "public", ingressRules: [{ ...ssh, cidr: "203.0.113.10/32" }] } })]);
    expect(findingsFor(ok, "CS-NET-001")).toHaveLength(0);
  });

  it("detects SSH inside a wider port range", () => {
    const range = model([node("x", "ec2", { config: { subnetTier: "public", ingressRules: [{ ...ssh, fromPort: 20, toPort: 30 }] } })]);
    expect(findingsFor(range, "CS-NET-001")).toHaveLength(1);
  });
});

describe("network rules", () => {
  it("detects RDP from the internet", () => {
    const m = model([node("w", "ec2", { config: { subnetTier: "public", ingressRules: [rdp] } })]);
    expect(findingsFor(m, "CS-NET-002")).toHaveLength(1);
  });

  it("reports all-ports rules once as critical (not also as SSH/RDP)", () => {
    const m = model([
      node("w", "ec2", { config: { subnetTier: "public", ingressRules: [{ protocol: "-1", fromPort: 0, toPort: 0, cidr: "0.0.0.0/0" }] } }),
    ]);
    const ids = analyzeSecurity(m).findings.map((f) => f.ruleId);
    expect(ids).toContain("CS-NET-003");
    expect(ids).not.toContain("CS-NET-001");
    expect(ids).not.toContain("CS-NET-002");
    expect(findingsFor(m, "CS-NET-003")[0].severity).toBe("critical");
  });

  it("detects database ports open to the internet on RDS and EC2", () => {
    const pg: IngressRule = { protocol: "tcp", fromPort: 5432, toPort: 5432, cidr: "0.0.0.0/0" };
    const m = model([
      node("db", "rds", { config: { publiclyAccessible: true, ingressRules: [pg] } }),
      node("e", "ec2", { config: { ingressRules: [{ ...pg, fromPort: 6379, toPort: 6379 }] } }),
    ]);
    const f = findingsFor(m, "CS-NET-004");
    expect(f.map((x) => x.resource.id).sort()).toEqual(["db", "e"]);
    expect(f.find((x) => x.resource.id === "db")!.severity).toBe("critical");
  });

  it("flags public instances, more strongly when they bypass an ALB", () => {
    const m = model(
      [
        node("alb", "load-balancer"),
        node("a", "ec2", { config: { subnetTier: "public" } }),
        node("b", "ec2", { config: { subnetTier: "public" } }),
      ],
      [edge("alb", "a")]
    );
    const f = findingsFor(m, "CS-NET-005");
    expect(f.find((x) => x.resource.id === "a")!.severity).toBe("medium");
    expect(f.find((x) => x.resource.id === "b")!.severity).toBe("low");
  });

  it("requires VPC flow logs only when a VPC is generated", () => {
    expect(findingsFor(model([node("b", "s3")]), "CS-LOG-001")).toHaveLength(0);
    expect(findingsFor(model([node("e", "ec2")]), "CS-LOG-001")).toHaveLength(1);
    expect(findingsFor(model([node("e", "ec2")], [], { enableFlowLogs: true }), "CS-LOG-001")).toHaveLength(0);
  });
});

describe("data protection rules", () => {
  it("detects publicly accessible and unencrypted databases", () => {
    const m = model([node("db", "rds", { config: { publiclyAccessible: true, storageEncrypted: false, backupRetentionDays: 0 } })]);
    const ids = analyzeSecurity(m).findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["CS-RDS-001", "CS-RDS-002", "CS-RDS-003"]));
    expect(findingsFor(m, "CS-RDS-001")[0].severity).toBe("high");
  });

  it("detects S3 buckets that can become public, with medium confidence", () => {
    const m = model([node("b", "s3", { config: { blockPublicAccess: false } })]);
    const [f] = findingsFor(m, "CS-S3-001");
    expect(f.severity).toBe("high");
    expect(f.confidence).toBe("medium");
  });

  it("reports missing explicit S3 encryption as low and explains the SSE-S3 default", () => {
    const [f] = findingsFor(model([node("b", "s3", { config: { encryption: "none" } })]), "CS-S3-002");
    expect(f.severity).toBe("low");
    expect(f.risk).toMatch(/SSE-S3 by default/);
  });

  it("detects unencrypted EBS and IMDSv1", () => {
    const m = model([node("e", "ec2", { config: { rootVolumeEncrypted: false, imdsv2Required: false } })]);
    expect(findingsFor(m, "CS-EC2-001")).toHaveLength(1);
    expect(findingsFor(m, "CS-EC2-002")).toHaveLength(1);
  });
});

describe("identity rules", () => {
  it.each([
    [["*"], "critical"],
    [["s3:*"], "high"],
    [["iam:PassRole"], "high"],
    [["dynamodb:GetItem"], "low"],
  ] as const)("extra permissions %j -> %s", (actions, severity) => {
    const m = model([node("f", "lambda", { config: { extraPermissions: [...actions] } })]);
    const [f] = findingsFor(m, "CS-IAM-001");
    expect(f.severity).toBe(severity);
    expect(f.evidence[0].value).toEqual(actions);
  });
});

describe("transport rules", () => {
  it("flags HTTP-only ALB and explains CloudFront fronting", () => {
    const m = model(
      [node("cf", "cloudfront"), node("alb", "load-balancer"), node("e", "ec2")],
      [edge("cf", "alb"), edge("alb", "e")]
    );
    const [f] = findingsFor(m, "CS-ALB-001");
    expect(f.risk).toMatch(/CloudFront → ALB/);
  });

  it("flags CloudFront allow-all viewer protocol", () => {
    const m = model(
      [node("cf", "cloudfront", { config: { viewerProtocolPolicy: "allow-all" } }), node("b", "s3")],
      [edge("cf", "b")]
    );
    expect(findingsFor(m, "CS-CF-001")).toHaveLength(1);
  });
});

describe("report", () => {
  it("is deterministic and sorted by severity", () => {
    const m = model([
      node("b", "s3", { config: { versioning: false } }),
      node("f", "lambda", { config: { extraPermissions: ["*"] } }),
      node("e", "ec2", { config: { subnetTier: "public", ingressRules: [ssh] } }),
    ]);
    const a = analyzeSecurity(m);
    expect(analyzeSecurity(m)).toEqual(a);
    expect(a.highest).toBe("critical");
    const ranks = a.findings.map((f) => SEVERITY_ORDER[f.severity]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });

  it("every finding carries the required fields", () => {
    const m = model([
      node("e", "ec2", { config: { subnetTier: "public", ingressRules: [ssh, rdp], imdsv2Required: false } }),
      node("db", "rds", { config: { publiclyAccessible: true } }),
    ]);
    for (const f of analyzeSecurity(m).findings) {
      expect(f.id).toBeTruthy();
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.risk.length).toBeGreaterThan(20);
      expect(f.remediation.length).toBeGreaterThan(10);
      expect(f.resource.terraformAddress).toMatch(/^aws_[a-z0-9_]+\.[a-z_][a-z0-9_]*$/);
      expect(f.configReference).toBeTruthy();
    }
  });
});
