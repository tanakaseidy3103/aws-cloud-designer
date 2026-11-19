import { describe, expect, it } from "vitest";
import {
  isFrontedByCloudFront,
  lambdaNeedsVpc,
  needsVpc,
  sourcesOf,
  targetsOf,
  toTerraformIdentifier,
} from "@/lib/infra/model";
import { allowedPartners, findRelationshipRule } from "@/lib/infra/relationships";
import { edge, model, node } from "../fixtures/builders";

describe("toTerraformIdentifier", () => {
  it.each([
    ["Web Server 1", "web_server_1"],
    ["2nd server", "r_2nd_server"],
    ["  ", "ec2"],
    ["Ação São Paulo", "acao_sao_paulo"],
    ["count", "count_res"],
    ["api-gateway--alb", "api_gateway_alb"],
  ])("%j → %s", (label, expected) => {
    expect(toTerraformIdentifier(label, "ec2")).toBe(expected);
  });

  it("always yields a valid Terraform identifier", () => {
    for (const label of ["!!!", "日本語", "9", "_x_", "a".repeat(200)]) {
      expect(toTerraformIdentifier(label, "res")).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});

describe("buildInfraModel", () => {
  it("assigns unique, deterministic Terraform names to duplicate labels", () => {
    const m = model([
      node("a", "ec2", { label: "Web" }),
      node("b", "ec2", { label: "Web" }),
      node("c", "ec2", { label: "Web 2" }),
    ]);
    const names = m.resources.map((r) => r.tfName);
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(["web", "web_2", "web_2_2"]);
  });

  it("is independent of edge id format (React Flow ids share prefixes)", () => {
    const nodes = [node("alb", "load-balancer"), node("w1", "ec2"), node("w2", "ec2")];
    const m = model(nodes, [edge("alb", "w1", "xy-edge__1"), edge("alb", "w2", "xy-edge__2")]);
    expect(m.relationships).toHaveLength(2);
    expect(m.edgeIssues).toHaveLength(0);
  });

  it("normalizes reversed edges to the request direction", () => {
    const m = model([node("db", "rds"), node("app", "ec2")], [edge("db", "app")]);
    expect(m.relationships[0]).toMatchObject({
      kind: "db-client",
      sourceId: "app",
      targetId: "db",
      reversed: true,
    });
  });

  it("reports unsupported, self-loop, dangling and duplicate edges", () => {
    const m = model(
      [node("s3", "s3"), node("db", "rds"), node("app", "ec2")],
      [
        edge("s3", "db"),
        edge("app", "app"),
        edge("app", "ghost"),
        edge("app", "db", "e1"),
        edge("db", "app", "e2"),
      ]
    );
    const reasons = m.edgeIssues.map((i) => i.reason).sort();
    expect(reasons).toEqual(["dangling", "duplicate", "self-loop", "unsupported"]);
    expect(m.relationships).toHaveLength(1);
  });

  it("selects the most common region and lists all of them", () => {
    const m = model([
      node("a", "s3", { region: "eu-west-1" }),
      node("b", "s3", { region: "us-east-1" }),
      node("c", "s3", { region: "eu-west-1" }),
    ]);
    expect(m.region).toBe("eu-west-1");
    expect(m.regions).toEqual(["eu-west-1", "us-east-1"]);
  });

  it("applies default instance types", () => {
    const m = model([node("a", "ec2"), node("b", "rds"), node("c", "rds", { instanceType: "db.t3.small" })]);
    expect(m.resources.map((r) => r.instanceType)).toEqual(["t3.micro", "db.t4g.micro", "db.t3.small"]);
  });
});

describe("query helpers", () => {
  const m = model(
    [
      node("cf", "cloudfront"),
      node("alb", "load-balancer"),
      node("app", "ec2"),
      node("fn", "lambda"),
      node("db", "rds"),
      node("bucket", "s3"),
    ],
    [edge("cf", "alb"), edge("alb", "app"), edge("app", "db"), edge("fn", "db"), edge("fn", "bucket")]
  );

  it("finds targets and sources by relationship kind", () => {
    expect(targetsOf(m, "alb", "lb-target").map((r) => r.id)).toEqual(["app"]);
    expect(sourcesOf(m, "db", "db-client").map((r) => r.id)).toEqual(["app", "fn"]);
  });

  it("derives VPC placement needs", () => {
    expect(lambdaNeedsVpc(m, "fn")).toBe(true);
    expect(needsVpc(m)).toBe(true);
    expect(needsVpc(model([node("b", "s3"), node("f", "lambda")]))).toBe(false);
  });

  it("detects CloudFront-fronted load balancers", () => {
    expect(isFrontedByCloudFront(m, "alb")).toBe(true);
  });
});

describe("relationship rules", () => {
  it("only allows documented relationships", () => {
    expect(findRelationshipRule("cloudfront", "ec2")).toBeNull();
    expect(findRelationshipRule("s3", "rds")).toBeNull();
    expect(findRelationshipRule("rds", "rds")).toBeNull();
    expect(findRelationshipRule("s3", "cloudfront")?.reversed).toBe(true);
  });

  it("lists allowed partners", () => {
    expect(allowedPartners("rds").sort()).toEqual(["ec2", "lambda"]);
  });
});
