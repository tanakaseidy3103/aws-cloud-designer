import { describe, expect, it } from "vitest";
import { generateTerraformFromModel } from "@/lib/iac/generator";
import type { InfraModel } from "@/lib/infra/model";
import { edge, model, node } from "../fixtures/builders";
import { check, describeFailures, parallelSafe, terraform } from "./helpers";

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
};

describe.skipIf(!terraform)("generated Terraform passes fmt and validate", () => {
  for (const [name, m] of Object.entries(GENERATOR_FIXTURES)) {
    (parallelSafe ? it.concurrent : it)(name, async () => {
      const { files } = generateTerraformFromModel(m);
      const tfFiles = Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith(".tf")));
      const result = await check(tfFiles);
      expect(result.steps.find((s) => s.step === "fmt")?.status, describeFailures(result)).toBe("passed");
      expect(result.ok, describeFailures(result)).toBe(true);
    });
  }
});
