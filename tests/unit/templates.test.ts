import { describe, expect, it } from "vitest";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";
import { buildInfraModel } from "@/lib/infra/model";
import { validateModel } from "@/lib/validation";
import { analyzeSecurity } from "@/lib/security";

describe("bundled templates", () => {
  for (const t of ARCHITECTURE_TEMPLATES) {
    describe(t.name, () => {
      const m = buildInfraModel({ name: t.name, nodes: t.nodes, edges: t.edges });

      it("validates without errors or unsupported edges", () => {
        const errors = validateModel(m).warnings.filter((w) => w.type === "error");
        expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
        expect(m.edgeIssues).toEqual([]);
      });

      it("uses low-cost instance sizes", () => {
        for (const r of m.resources) {
          if (r.type === "ec2") expect(r.instanceType).toMatch(/^t[34]g?\.(micro|small)$/);
          if (r.type === "rds") expect(r.instanceType).toMatch(/^db\.t4g\.(micro|small)$/);
        }
      });

      if (!t.scenario) {
        it("has no critical or high security findings", () => {
          const { counts } = analyzeSecurity(m);
          expect(counts.critical + counts.high).toBe(0);
        });
      }
    });
  }

  it("Scenario 1 template triggers the SSH exposure finding", () => {
    const t = ARCHITECTURE_TEMPLATES.find((x) => x.scenario === "1")!;
    const report = analyzeSecurity(buildInfraModel({ nodes: t.nodes, edges: t.edges }));
    const ssh = report.findings.find((f) => f.ruleId === "CS-NET-001");
    expect(ssh?.severity).toBe("high");
    expect(ssh?.resource.label).toBe("Web Server");
  });
});
