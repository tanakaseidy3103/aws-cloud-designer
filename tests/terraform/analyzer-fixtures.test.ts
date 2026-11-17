import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, describeFailures, parallelSafe, terraform } from "./helpers";

/**
 * The analyzer's fixtures must be configurations Terraform itself accepts,
 * so that findings describe real-world-valid code, not parser artifacts.
 */
const ROOT = path.join(__dirname, "..", "fixtures", "terraform");

describe.skipIf(!terraform)("analyzer fixtures pass terraform fmt and validate", () => {
  for (const dir of ["insecure", "secure", "unresolved"]) {
    (parallelSafe ? it.concurrent : it)(dir, async () => {
      const files = Object.fromEntries(
        readdirSync(path.join(ROOT, dir)).map((f) => [f, readFileSync(path.join(ROOT, dir, f), "utf8")])
      );
      const result = await check(files);
      expect(result.steps.find((s) => s.step === "fmt")?.status, describeFailures(result)).toBe("passed");
      expect(result.ok, describeFailures(result)).toBe(true);
    });
  }

  it("the invalid fixture is rejected by terraform as well", async () => {
    const result = await check({ "broken.tf": readFileSync(path.join(ROOT, "invalid", "broken.tf"), "utf8") });
    expect(result.ok).toBe(false);
  });
});
