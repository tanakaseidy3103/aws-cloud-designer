import type {
  AwsComponentType,
  CloudFrontConfig,
  Ec2Config,
  IngressRule,
  LambdaConfig,
  LoadBalancerConfig,
  NetworkSettings,
  RdsConfig,
  ResourceConfigByType,
  S3Config,
} from "@/types";

/**
 * Secure, low-cost defaults. A resource dropped on the canvas without any
 * configuration must not produce a security finding above "Low" and must
 * not create billable resources beyond the resource itself (e.g. no NAT).
 */
export const DEFAULT_CONFIG: { [K in AwsComponentType]: ResourceConfigByType[K] } = {
  ec2: {
    subnetTier: "private",
    appPort: 80,
    ingressRules: [],
    rootVolumeEncrypted: true,
    rootVolumeSizeGb: 8,
    imdsv2Required: true,
  },
  rds: {
    engine: "postgres",
    allocatedStorageGb: 20,
    publiclyAccessible: false,
    storageEncrypted: true,
    backupRetentionDays: 7,
    multiAz: false,
    deletionProtection: false,
    ingressRules: [],
  },
  s3: {
    blockPublicAccess: true,
    encryption: "aes256",
    versioning: true,
  },
  lambda: {
    runtime: "nodejs20.x",
    memoryMb: 128,
    timeoutSeconds: 10,
    extraPermissions: [],
  },
  "load-balancer": {
    internal: false,
    httpsEnabled: false,
  },
  cloudfront: {
    viewerProtocolPolicy: "redirect-to-https",
    priceClass: "PriceClass_100",
  },
};

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  vpcCidr: "10.0.0.0/16",
  azCount: 2,
  enableNatGateway: false,
  enableFlowLogs: false,
};

export const DEFAULT_INSTANCE_TYPE: Partial<Record<AwsComponentType, string>> = {
  ec2: "t3.micro",
  rds: "db.t4g.micro",
};

export const RDS_ENGINE_PORT: Record<RdsConfig["engine"], number> = {
  postgres: 5432,
  mysql: 3306,
};

function cloneRules(rules: IngressRule[] | undefined): IngressRule[] {
  return (rules ?? []).map((r) => ({ ...r }));
}

/**
 * Merge a partial node configuration with the defaults for its type.
 * Unknown keys are dropped; arrays are copied so callers can't mutate defaults.
 */
export function resolveConfig<K extends AwsComponentType>(
  type: K,
  partial: Partial<ResourceConfigByType[K]> | undefined
): ResourceConfigByType[K] {
  const defaults = DEFAULT_CONFIG[type];
  const merged: Record<string, unknown> = { ...defaults };
  if (partial) {
    for (const key of Object.keys(defaults)) {
      const value = (partial as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }

  switch (type) {
    case "ec2": {
      const c = merged as unknown as Ec2Config;
      return { ...c, ingressRules: cloneRules(c.ingressRules) } as ResourceConfigByType[K];
    }
    case "rds": {
      const c = merged as unknown as RdsConfig;
      return { ...c, ingressRules: cloneRules(c.ingressRules) } as ResourceConfigByType[K];
    }
    case "lambda": {
      const c = merged as unknown as LambdaConfig;
      return { ...c, extraPermissions: [...c.extraPermissions] } as ResourceConfigByType[K];
    }
    default:
      return merged as unknown as ResourceConfigByType[K];
  }
}

export function resolveNetworkSettings(partial?: Partial<NetworkSettings>): NetworkSettings {
  return { ...DEFAULT_NETWORK_SETTINGS, ...(partial ?? {}) };
}

/* ------------------------------------------------------------------------ */
/* Value validation helpers                                                 */
/* ------------------------------------------------------------------------ */

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export function isValidIpv4Cidr(value: string): boolean {
  const m = IPV4_CIDR.exec(value.trim());
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  return octets.every((o) => o >= 0 && o <= 255) && prefix >= 0 && prefix <= 32;
}

export function isPortRangeValid(rule: IngressRule): boolean {
  if (rule.protocol === "-1") return true;
  return (
    Number.isInteger(rule.fromPort) &&
    Number.isInteger(rule.toPort) &&
    rule.fromPort >= 0 &&
    rule.toPort <= 65535 &&
    rule.fromPort <= rule.toPort
  );
}

/** True when the rule's port range contains `port` (protocol "-1" = all). */
export function ruleCoversPort(rule: IngressRule, port: number): boolean {
  if (rule.protocol === "-1") return true;
  if (rule.protocol !== "tcp") return false;
  return rule.fromPort <= port && port <= rule.toPort;
}

export function isInternetCidr(cidr: string): boolean {
  return cidr.trim() === "0.0.0.0/0";
}

const IAM_ACTION = /^(\*|[a-z0-9-]+:[A-Za-z0-9*]+)$/;

export function isValidIamAction(action: string): boolean {
  return IAM_ACTION.test(action);
}

export type ConfigOf<K extends AwsComponentType> = ResourceConfigByType[K];
export type { Ec2Config, RdsConfig, S3Config, LambdaConfig, LoadBalancerConfig, CloudFrontConfig };
