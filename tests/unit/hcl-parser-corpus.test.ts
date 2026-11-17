import { describe, expect, it } from "vitest";
import { parseHcl } from "@/lib/hcl-parser/parser";
import { generateTerraformFromModel } from "@/lib/iac/generator";
import { generateTerraform } from "@/lib/terraform";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";
import { GENERATOR_FIXTURES } from "../fixtures/generator-fixtures";

/** Every configuration here passes `terraform validate` in tests/terraform. */
const corpus: [string, Record<string, string>][] = [
  ...Object.entries(GENERATOR_FIXTURES).map(([n, m]) => [n, generateTerraformFromModel(m).files] as [string, Record<string, string>]),
  ...ARCHITECTURE_TEMPLATES.map((t) => [t.id, generateTerraform(t.id, t.nodes, t.edges, { name: t.name }).files] as [string, Record<string, string>]),
];

describe("parser accepts every terraform-validated configuration", () => {
  for (const [name, files] of corpus) {
    it(name, () => {
      for (const [file, src] of Object.entries(files)) {
        if (!file.endsWith(".tf")) continue;
        const parsed = parseHcl(src, file);
        expect(parsed.diagnostics, `${name}/${file}`).toEqual([]);
        const expected = (src.match(/^(resource|data|variable|output|locals|provider|terraform) /gm) ?? []).length;
        expect(parsed.body.blocks.length, `${name}/${file}`).toBe(expected);
      }
    });
  }
});
