import { describe, expect, it } from "vitest";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";
import { generateTerraform } from "@/lib/terraform";
import { check, describeFailures, parallelSafe, terraform } from "./helpers";

describe.skipIf(!terraform)("bundled templates generate valid Terraform", () => {
  for (const t of ARCHITECTURE_TEMPLATES) {
    (parallelSafe ? it.concurrent : it)(t.name, async () => {
      // Simulate React Flow's edge ids, which share a long common prefix.
      const edges = t.edges.map((e, i) => ({ ...e, id: `xy-edge__${e.source}-${e.target}-${i}` }));
      const { files } = generateTerraform(t.id, t.nodes, edges, { name: t.name });
      const tf = Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith(".tf")));
      const result = await check(tf);
      expect(result.steps.find((s) => s.step === "fmt")?.status, describeFailures(result)).toBe("passed");
      expect(result.ok, describeFailures(result)).toBe(true);
    });
  }
});
