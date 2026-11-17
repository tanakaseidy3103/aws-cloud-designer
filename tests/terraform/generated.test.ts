import { describe, expect, it } from "vitest";
import { generateTerraformFromModel } from "@/lib/iac/generator";
import type { InfraModel } from "@/lib/infra/model";
import { model, node } from "../fixtures/builders";
import { check, describeFailures, terraform } from "./helpers";

const fixtures: Record<string, InfraModel> = {
  "network-only": model([node("app", "ec2", { label: "App" })]),
  "network-with-options": model([node("app", "ec2")], [], { azCount: 3, enableNatGateway: true, enableFlowLogs: true }),
  "s3-only": model([node("bucket", "s3")]),
};

describe.skipIf(!terraform)("generated Terraform passes fmt and validate", () => {
  for (const [name, m] of Object.entries(fixtures)) {
    it.concurrent(name, async () => {
      const { files } = generateTerraformFromModel(m);
      const tfFiles = Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith(".tf")));
      const result = await check(tfFiles);
      expect(result.steps.find((s) => s.step === "fmt")?.status, describeFailures(result)).toBe("passed");
      expect(result.ok, describeFailures(result)).toBe(true);
    });
  }
});

