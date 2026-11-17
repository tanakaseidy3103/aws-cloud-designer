export type AwsComponentType =
  | "ec2"
  | "s3"
  | "rds"
  | "lambda"
  | "load-balancer"
  | "cloudfront";

export interface AwsComponentDefinition {
  type: AwsComponentType;
  label: string;
  description: string;
  category: "compute" | "storage" | "database" | "networking" | "serverless";
  color: string;
  defaultLabel: string;
  nodeType: string;
}

/* ------------------------------------------------------------------------ */
/* Resource configuration                                                   */
/*                                                                          */
/* Every field is optional on the canvas node so that designs saved before  */
/* configuration existed keep loading. `lib/infra/config.ts` resolves the   */
/* partial config against secure defaults.                                  */
/* ------------------------------------------------------------------------ */

export type SubnetTier = "public" | "private";

export type IngressProtocol = "tcp" | "udp" | "-1";

/** A CIDR-based ingress rule declared by the user on a resource. */
export interface IngressRule {
  description?: string;
  protocol: IngressProtocol;
  fromPort: number;
  toPort: number;
  /** IPv4 CIDR, e.g. "203.0.113.0/24" or "0.0.0.0/0". */
  cidr: string;
}

export interface Ec2Config {
  subnetTier: SubnetTier;
  /** Port the application listens on; used for ALB → EC2 rules. */
  appPort: number;
  ingressRules: IngressRule[];
  rootVolumeEncrypted: boolean;
  rootVolumeSizeGb: number;
  /** Require IMDSv2 session tokens (blocks SSRF credential theft via IMDSv1). */
  imdsv2Required: boolean;
}

export type RdsEngine = "postgres" | "mysql";

export interface RdsConfig {
  engine: RdsEngine;
  allocatedStorageGb: number;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  backupRetentionDays: number;
  multiAz: boolean;
  deletionProtection: boolean;
  ingressRules: IngressRule[];
}

export type S3Encryption = "aes256" | "kms" | "none";

export interface S3Config {
  blockPublicAccess: boolean;
  encryption: S3Encryption;
  versioning: boolean;
}

export type LambdaRuntime = "nodejs20.x" | "python3.12";

export interface LambdaConfig {
  runtime: LambdaRuntime;
  memoryMb: number;
  timeoutSeconds: number;
  /**
   * Additional IAM actions granted on Resource "*", e.g. ["dynamodb:GetItem"].
   * Relationship-derived permissions (S3 access, VPC access) are added
   * automatically and scoped to the connected resource.
   */
  extraPermissions: string[];
}

export interface LoadBalancerConfig {
  internal: boolean;
  /** Adds an HTTPS listener; requires an ACM certificate ARN variable. */
  httpsEnabled: boolean;
}

export type ViewerProtocolPolicy = "redirect-to-https" | "https-only" | "allow-all";
export type CloudFrontPriceClass = "PriceClass_100" | "PriceClass_200" | "PriceClass_All";

export interface CloudFrontConfig {
  viewerProtocolPolicy: ViewerProtocolPolicy;
  priceClass: CloudFrontPriceClass;
}

export interface ResourceConfigByType {
  ec2: Ec2Config;
  s3: S3Config;
  rds: RdsConfig;
  lambda: LambdaConfig;
  "load-balancer": LoadBalancerConfig;
  cloudfront: CloudFrontConfig;
}

export type AnyResourceConfig = ResourceConfigByType[AwsComponentType];

/** Architecture-wide network settings (one VPC per architecture). */
export interface NetworkSettings {
  vpcCidr: string;
  /** Number of availability zones (2 or 3). ALB and RDS need at least 2. */
  azCount: number;
  /** NAT Gateway gives private subnets outbound internet access. Billed hourly. */
  enableNatGateway: boolean;
  /** VPC Flow Logs to CloudWatch Logs. */
  enableFlowLogs: boolean;
}

export interface AwsNodeData extends Record<string, unknown> {
  componentType: AwsComponentType;
  label: string;
  description?: string;
  instanceType?: string;
  region?: string;
  /** Partial configuration; missing fields fall back to secure defaults. */
  config?: Partial<AnyResourceConfig>;
}

export interface ComponentPaletteItem extends AwsComponentDefinition {
  draggable: true;
}
