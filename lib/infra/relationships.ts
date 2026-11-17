import type { AwsComponentType } from "@/types";

/**
 * Semantic meaning of an edge on the canvas. Every edge must map to exactly
 * one of these; anything else is reported as unsupported instead of being
 * silently ignored by the Terraform generator.
 */
export type RelationshipKind =
  /** CloudFront fetches content from an origin (S3 or ALB). */
  | "cdn-origin"
  /** ALB forwards requests to a target (EC2 or Lambda). */
  | "lb-target"
  /** Compute connects to a database over the network. */
  | "db-client"
  /** Compute reads/writes objects in a bucket (IAM permission, not network). */
  | "storage-access";

export interface RelationshipRule {
  kind: RelationshipKind;
  source: AwsComponentType;
  target: AwsComponentType;
  description: string;
}

/** Canonical direction: source → target, following the request flow. */
export const RELATIONSHIP_RULES: readonly RelationshipRule[] = [
  {
    kind: "cdn-origin",
    source: "cloudfront",
    target: "s3",
    description: "CloudFront serves objects from the bucket through Origin Access Control.",
  },
  {
    kind: "cdn-origin",
    source: "cloudfront",
    target: "load-balancer",
    description: "CloudFront forwards dynamic requests to the Application Load Balancer.",
  },
  {
    kind: "lb-target",
    source: "load-balancer",
    target: "ec2",
    description: "The ALB forwards traffic to the instance through a target group.",
  },
  {
    kind: "lb-target",
    source: "load-balancer",
    target: "lambda",
    description: "The ALB invokes the function through a Lambda target group.",
  },
  {
    kind: "db-client",
    source: "ec2",
    target: "rds",
    description: "The instance connects to the database port; allowed security-group to security-group.",
  },
  {
    kind: "db-client",
    source: "lambda",
    target: "rds",
    description: "The function runs inside the VPC and connects to the database port.",
  },
  {
    kind: "storage-access",
    source: "ec2",
    target: "s3",
    description: "The instance role gets read/write access scoped to this bucket.",
  },
  {
    kind: "storage-access",
    source: "lambda",
    target: "s3",
    description: "The function role gets read/write access scoped to this bucket.",
  },
];

export interface RelationshipMatch {
  rule: RelationshipRule;
  /** True when the edge was drawn target → source and was normalized. */
  reversed: boolean;
}

export function findRelationshipRule(
  sourceType: AwsComponentType,
  targetType: AwsComponentType
): RelationshipMatch | null {
  const forward = RELATIONSHIP_RULES.find(
    (r) => r.source === sourceType && r.target === targetType
  );
  if (forward) return { rule: forward, reversed: false };
  const backward = RELATIONSHIP_RULES.find(
    (r) => r.source === targetType && r.target === sourceType
  );
  if (backward) return { rule: backward, reversed: true };
  return null;
}

/** Human-readable list of what a given type may connect to (for UI hints). */
export function allowedPartners(type: AwsComponentType): AwsComponentType[] {
  const partners = new Set<AwsComponentType>();
  for (const r of RELATIONSHIP_RULES) {
    if (r.source === type) partners.add(r.target);
    if (r.target === type) partners.add(r.source);
  }
  return [...partners];
}
