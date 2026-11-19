import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  isInternetCidr,
  isPortRangeValid,
  isValidIamAction,
  isValidIpv4Cidr,
  resolveConfig,
  resolveNetworkSettings,
  ruleCoversPort,
} from "@/lib/infra/config";

describe("resolveConfig", () => {
  it("returns secure defaults when no config is present (legacy nodes)", () => {
    const ec2 = resolveConfig("ec2", undefined);
    expect(ec2.subnetTier).toBe("private");
    expect(ec2.imdsv2Required).toBe(true);
    expect(ec2.rootVolumeEncrypted).toBe(true);
    expect(ec2.ingressRules).toEqual([]);

    const rds = resolveConfig("rds", undefined);
    expect(rds.publiclyAccessible).toBe(false);
    expect(rds.storageEncrypted).toBe(true);

    const s3 = resolveConfig("s3", undefined);
    expect(s3.blockPublicAccess).toBe(true);
    expect(s3.encryption).toBe("aes256");
  });

  it("overrides only provided keys and drops unknown keys", () => {
    const rds = resolveConfig("rds", { publiclyAccessible: true, bogus: 1 } as never);
    expect(rds.publiclyAccessible).toBe(true);
    expect(rds.storageEncrypted).toBe(true);
    expect(rds).not.toHaveProperty("bogus");
  });

  it("does not share array references with defaults", () => {
    const a = resolveConfig("ec2", undefined);
    a.ingressRules.push({ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0" });
    expect(DEFAULT_CONFIG.ec2.ingressRules).toHaveLength(0);
    expect(resolveConfig("ec2", undefined).ingressRules).toHaveLength(0);
  });

  it("uses cost-safe network defaults (no NAT gateway)", () => {
    const net = resolveNetworkSettings();
    expect(net.enableNatGateway).toBe(false);
    expect(net.azCount).toBe(2);
    expect(resolveNetworkSettings({ azCount: 3 }).azCount).toBe(3);
  });
});

describe("validation helpers", () => {
  it.each([
    ["10.0.0.0/16", true],
    ["0.0.0.0/0", true],
    ["203.0.113.7/32", true],
    ["256.0.0.0/8", false],
    ["10.0.0.0/33", false],
    ["10.0.0.0", false],
    ["abc", false],
  ])("isValidIpv4Cidr(%s) = %s", (cidr, ok) => {
    expect(isValidIpv4Cidr(cidr)).toBe(ok);
  });

  it("checks port ranges", () => {
    expect(isPortRangeValid({ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "x" })).toBe(true);
    expect(isPortRangeValid({ protocol: "tcp", fromPort: 100, toPort: 10, cidr: "x" })).toBe(false);
    expect(isPortRangeValid({ protocol: "tcp", fromPort: 0, toPort: 70000, cidr: "x" })).toBe(false);
    expect(isPortRangeValid({ protocol: "-1", fromPort: 0, toPort: 0, cidr: "x" })).toBe(true);
  });

  it("detects port coverage, including all-traffic rules", () => {
    const range = { protocol: "tcp" as const, fromPort: 20, toPort: 25, cidr: "0.0.0.0/0" };
    expect(ruleCoversPort(range, 22)).toBe(true);
    expect(ruleCoversPort(range, 3389)).toBe(false);
    expect(ruleCoversPort({ ...range, protocol: "-1" }, 3389)).toBe(true);
    expect(ruleCoversPort({ ...range, protocol: "udp" }, 22)).toBe(false);
  });

  it("recognises internet CIDR and IAM action syntax", () => {
    expect(isInternetCidr("0.0.0.0/0")).toBe(true);
    expect(isInternetCidr("10.0.0.0/8")).toBe(false);
    expect(isValidIamAction("s3:GetObject")).toBe(true);
    expect(isValidIamAction("s3:*")).toBe(true);
    expect(isValidIamAction("*")).toBe(true);
    expect(isValidIamAction("not an action")).toBe(false);
  });
});
