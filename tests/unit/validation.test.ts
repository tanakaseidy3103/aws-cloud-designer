import { describe, expect, it } from "vitest";
import { validateModel } from "@/lib/validation";
import { edge, model, node } from "../fixtures/builders";

const codes = (m: ReturnType<typeof model>) => validateModel(m).warnings.map((w) => w.code);

describe("validateModel", () => {
  it("accepts a coherent 3-tier design without errors", () => {
    const r = validateModel(
      model(
        [node("cf", "cloudfront"), node("alb", "load-balancer"), node("a", "ec2"), node("b", "ec2"), node("db", "rds")],
        [edge("cf", "alb"), edge("alb", "a"), edge("alb", "b"), edge("a", "db"), edge("b", "db")]
      )
    );
    expect(r.isValid).toBe(true);
    expect(r.warnings.filter((w) => w.type === "error")).toEqual([]);
  });

  it("rejects relationships with no supported meaning (ARCH-001)", () => {
    const r = validateModel(model([node("s3", "s3"), node("db", "rds")], [edge("s3", "db")]));
    expect(r.isValid).toBe(false);
    const w = r.warnings.find((x) => x.code === "ARCH-001")!;
    expect(w.affectedNodeIds.sort()).toEqual(["db", "s3"]);
    expect(r.recommendations.find((x) => x.id === `${w.id}:fix`)?.action).toMatch(/can connect to/);
  });

  it("explains reversed edges instead of silently dropping them (ARCH-005)", () => {
    expect(codes(model([node("db", "rds"), node("app", "ec2")], [edge("db", "app")]))).toContain("ARCH-005");
  });

  it("flags mixed regions (ARCH-010)", () => {
    const m = model([node("a", "s3", { region: "us-east-1" }), node("b", "s3", { region: "eu-west-1" })]);
    expect(codes(m)).toContain("ARCH-010");
  });

  it("flags load balancers without targets and invalid target mixes", () => {
    expect(codes(model([node("alb", "load-balancer")]))).toContain("ARCH-021");
    expect(
      codes(model([node("alb", "load-balancer"), node("e", "ec2"), node("f", "lambda")], [edge("alb", "e"), edge("alb", "f")]))
    ).toContain("ARCH-022");
    expect(
      codes(model([node("alb", "load-balancer"), node("f1", "lambda"), node("f2", "lambda")], [edge("alb", "f1"), edge("alb", "f2")]))
    ).toContain("ARCH-023");
  });

  it("flags CloudFront without origin, multiple origins and internal ALB origins", () => {
    expect(codes(model([node("cf", "cloudfront")]))).toContain("ARCH-024");
    expect(
      codes(model([node("cf", "cloudfront"), node("a", "s3"), node("b", "s3")], [edge("cf", "a"), edge("cf", "b")]))
    ).toContain("ARCH-025");
    const internal = model(
      [node("cf", "cloudfront"), node("alb", "load-balancer", { config: { internal: true } }), node("e", "ec2")],
      [edge("cf", "alb"), edge("alb", "e")]
    );
    expect(codes(internal)).toContain("ARCH-026");
  });

  it("rejects Aurora-only and malformed instance classes", () => {
    expect(codes(model([node("db", "rds", { instanceType: "db.serverless" })]))).toContain("ARCH-027");
    expect(codes(model([node("e", "ec2", { instanceType: "huge" })]))).toContain("ARCH-028");
  });

  it("validates ingress rules, IAM actions and network settings", () => {
    expect(
      codes(model([node("e", "ec2", { config: { ingressRules: [{ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "1.2.3/8" }] } })]))
    ).toContain("ARCH-029");
    expect(codes(model([node("f", "lambda", { config: { extraPermissions: ["bad action"] } })]))).toContain("ARCH-030");
    expect(codes(model([node("b", "s3")], [], { vpcCidr: "10.0.0.0/8" }))).toContain("ARCH-031");
    expect(codes(model([node("b", "s3")], [], { azCount: 1 }))).toContain("ARCH-032");
  });

  it("treats standalone buckets as informational but isolated servers as warnings", () => {
    const r = validateModel(model([node("b", "s3"), node("e", "ec2")]));
    const iso = r.warnings.filter((w) => w.code === "ARCH-011");
    expect(iso.find((w) => w.affectedNodeIds[0] === "b")?.type).toBe("info");
    expect(iso.find((w) => w.affectedNodeIds[0] === "e")?.type).toBe("warning");
  });

  it("produces stable, unique ids", () => {
    const m = model([node("cf", "cloudfront"), node("alb", "load-balancer")]);
    const a = validateModel(m).warnings.map((w) => w.id);
    expect(new Set(a).size).toBe(a.length);
    expect(validateModel(m).warnings.map((w) => w.id)).toEqual(a);
  });

  it("scores 100 for an empty canvas", () => {
    expect(validateModel(model([])).healthScore).toBe(100);
  });
});

describe("operational notes", () => {
  it("explains that a VPC Lambda without NAT cannot reach Secrets Manager (ARCH-036)", () => {
    const m = model([node("f", "lambda"), node("db", "rds")], [edge("f", "db")]);
    expect(codes(m)).toContain("ARCH-036");
    const withNat = model([node("f", "lambda"), node("db", "rds")], [edge("f", "db")], { enableNatGateway: true });
    expect(codes(withNat)).not.toContain("ARCH-036");
  });
});
