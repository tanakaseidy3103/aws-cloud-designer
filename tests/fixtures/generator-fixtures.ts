import type { InfraModel } from "@/lib/infra/model";
import { edge, model, node } from "./builders";

/** Designs that must generate fmt-clean, terraform-validate-clean configurations. */
export const GENERATOR_FIXTURES: Record<string, InfraModel> = {
  "network-only": model([node("app", "ec2", { label: "App" })]),
  "network-with-options": model([node("app", "ec2")], [], { azCount: 3, enableNatGateway: true, enableFlowLogs: true }),
  "s3-only": model([node("bucket", "s3")]),
  "app-db-bucket": model(
    [
      node("web1", "ec2", { label: "Web 1" }),
      node("web2", "ec2", { label: "Web 1" }),
      node("arm", "ec2", { label: "Graviton worker", instanceType: "t4g.small" }),
      node("db", "rds", { label: "Orders DB" }),
      node("bucket", "s3", { label: "Uploads", config: { encryption: "kms" } }),
    ],
    [edge("web1", "db"), edge("db", "web2", "xy-edge__dup-prefix"), edge("arm", "db"), edge("web1", "bucket")]
  ),
  "insecure-everything": model([
    node("bastion", "ec2", {
      label: "Bastion",
      config: {
        subnetTier: "public",
        imdsv2Required: false,
        rootVolumeEncrypted: false,
        ingressRules: [
          { protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0", description: 'ssh "anywhere" ${oops}' },
          { protocol: "-1", fromPort: 0, toPort: 0, cidr: "0.0.0.0/0" },
        ],
      },
    }),
    node("legacy", "rds", {
      label: "Legacy MySQL",
      config: {
        engine: "mysql",
        publiclyAccessible: true,
        storageEncrypted: false,
        backupRetentionDays: 0,
        ingressRules: [{ protocol: "tcp", fromPort: 3306, toPort: 3306, cidr: "0.0.0.0/0" }],
      },
    }),
    node("open", "s3", { label: "Open bucket", config: { blockPublicAccess: false, encryption: "none", versioning: false } }),
  ]),
  "serverless-api": model(
    [
      node("cf", "cloudfront", { label: "API CDN" }),
      node("alb", "load-balancer", { label: "API ALB" }),
      node("fn", "lambda", { label: "Orders API" }),
      node("db", "rds", { label: "Orders DB" }),
      node("assets", "s3", { label: "Assets" }),
    ],
    [edge("cf", "alb"), edge("alb", "fn"), edge("fn", "db"), edge("fn", "assets")]
  ),
  "https-3-tier": model(
    [
      node("cf", "cloudfront", { label: "Web CDN" }),
      node("alb", "load-balancer", { label: "Web ALB", config: { httpsEnabled: true } }),
      node("a", "ec2", { label: "App A", config: { appPort: 8080 } }),
      node("b", "ec2", { label: "App B", config: { appPort: 8080 } }),
      node("db", "rds", { label: "DB", config: { multiAz: true, deletionProtection: true } }),
    ],
    [edge("cf", "alb"), edge("alb", "a"), edge("alb", "b"), edge("a", "db"), edge("b", "db")]
  ),
  "static-site": model([node("cf", "cloudfront", { label: "Site" }), node("site", "s3", { label: "Site bucket" })], [edge("site", "cf")]),
  "edge-cases": model(
    [
      node("orphan-cf", "cloudfront", { label: "No origin" }),
      node("int", "load-balancer", { label: "Internal ALB", config: { internal: true } }),
      node("w", "ec2", { label: "Worker" }),
      node("mixed", "lambda", { label: "Py job", config: { runtime: "python3.12", extraPermissions: ["dynamodb:GetItem", "s3:*"] } }),
      node("pub", "load-balancer", { label: "Public ALB" }),
    ],
    [edge("int", "w"), edge("int", "mixed")]
  ),
};
