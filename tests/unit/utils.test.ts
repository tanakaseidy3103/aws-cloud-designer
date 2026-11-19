import { describe, expect, it } from "vitest";
import { cn, createNodeFromComponent, isAwsComponentType } from "@/lib/utils";

describe("lib/utils", () => {
  it("recognises supported component types only", () => {
    expect(isAwsComponentType("ec2")).toBe(true);
    expect(isAwsComponentType("cloudfront")).toBe(true);
    expect(isAwsComponentType("mainframe")).toBe(false);
  });

  it("creates a node with the component's defaults", () => {
    const node = createNodeFromComponent("rds", { x: 10, y: 20 });
    expect(node.type).toBe("rdsNode");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data.componentType).toBe("rds");
    expect(node.data.label).toBe("RDS Database");
  });

  it("joins truthy class names", () => {
    expect(cn("a", false, null, "b", undefined)).toBe("a b");
  });
});
