import { describe, expect, it } from "vitest";
import { LIMITS, parseArchitectureDocument } from "@/lib/infra/schema";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";

const valid = {
  name: "Demo",
  nodes: [
    {
      id: "a",
      position: { x: 1, y: 2 },
      data: { componentType: "ec2", label: "A", config: { subnetTier: "public", ingressRules: [{ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0" }] } },
    },
  ],
  edges: [],
  network: { azCount: 3 },
};

describe("parseArchitectureDocument", () => {
  it("accepts every bundled template (round trip)", () => {
    for (const t of ARCHITECTURE_TEMPLATES) {
      const r = parseArchitectureDocument({ name: t.name, nodes: t.nodes, edges: t.edges });
      expect(r.ok, t.name).toBe(true);
    }
  });

  it("keeps known fields and drops unknown ones", () => {
    const r = parseArchitectureDocument({ ...valid, nodes: [{ ...valid.nodes[0], data: { ...valid.nodes[0].data, evil: "<script>", config: { ...valid.nodes[0].data.config, bogus: 1 } } }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes[0].data).not.toHaveProperty("evil");
    expect(r.value.nodes[0].data.config).not.toHaveProperty("bogus");
    expect(r.value.nodes[0].type).toBe("ec2Node");
    expect(r.value.network).toEqual({ azCount: 3 });
  });

  it.each([
    [null, "document must be an object"],
    [{ nodes: {}, edges: [] }, "nodes must be an array"],
    [{ ...valid, nodes: [{ id: "x", data: { componentType: "mainframe", label: "m" } }] }, "is not supported"],
    [{ ...valid, nodes: [valid.nodes[0], valid.nodes[0]] }, "duplicated"],
    [{ ...valid, nodes: [{ id: "x", data: { componentType: "ec2", label: 5 } }] }, "label must be a string"],
    [{ ...valid, nodes: [{ id: "x", data: { componentType: "rds", label: "d", config: { publiclyAccessible: "yes" } } }] }, "must be a boolean"],
    [{ ...valid, nodes: [{ id: "x", data: { componentType: "ec2", label: "e", config: { ingressRules: [{ protocol: "icmp" }] } } }] }, "protocol must be"],
    [{ ...valid, edges: [{ id: "e", source: 1, target: "a" }] }, "source must be a string"],
    [{ ...valid, nodes: Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({ id: `n${i}`, data: { componentType: "s3", label: "b" } })) }, "nodes exceeds"],
  ])("rejects %#", (input, message) => {
    const r = parseArchitectureDocument(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});
