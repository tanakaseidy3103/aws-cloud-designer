import { describe, expect, it } from "vitest";
import { generateTerraformFromModel } from "@/lib/iac/generator";
import { GENERATOR_FIXTURES } from "../fixtures/generator-fixtures";
import { check, describeFailures, parallelSafe, terraform } from "./helpers";

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
