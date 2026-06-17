import type { Edge, Node } from "@xyflow/react";
import type { AwsNodeData } from "@/types";

export interface ValidationWarning {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  rule: string;
  affectedNodeIds: string[];
}

export interface Recommendation {
  id: string;
  message: string;
  action: string;
}

export interface ValidationResult {
  isValid: boolean;
  healthScore: number;
  warnings: ValidationWarning[];
  recommendations: Recommendation[];
}

export function validateArchitecture(
  nodes: Node<AwsNodeData>[],
  edges: Edge[]
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const recommendations: Recommendation[] = [];
  let score = 100;

  // Helpers to check target node types
  const getNodeType = (id: string): string | undefined => {
    return nodes.find((n) => n.id === id)?.data.componentType;
  };

  const getNodeLabel = (id: string): string => {
    return nodes.find((n) => n.id === id)?.data.label ?? "Unknown Resource";
  };

  // Rule 1: RDS must connect to EC2
  const rdsNodes = nodes.filter((n) => n.data.componentType === "rds");
  rdsNodes.forEach((rds) => {
    const isConnectedToEc2 = edges.some((edge) => {
      const isSource = edge.source === rds.id;
      const isTarget = edge.target === rds.id;
      if (isSource) {
        return getNodeType(edge.target) === "ec2";
      }
      if (isTarget) {
        return getNodeType(edge.source) === "ec2";
      }
      return false;
    });

    if (!isConnectedToEc2) {
      score -= 15;
      warnings.push({
        id: `rds-ec2-${rds.id}`,
        type: "error",
        message: `Database "${rds.data.label}" is not connected to any EC2 Instance.`,
        rule: "RDS database instances must connect to an EC2 compute instance to receive traffic.",
        affectedNodeIds: [rds.id],
      });
      recommendations.push({
        id: `rds-ec2-rec-${rds.id}`,
        message: `Connect database "${rds.data.label}" to an EC2 instance.`,
        action: "Drag a connection line between the database and an application server.",
      });
    }
  });

  // Rule 2: Load Balancer must connect to EC2
  const lbNodes = nodes.filter((n) => n.data.componentType === "load-balancer");
  lbNodes.forEach((lb) => {
    const isConnectedToEc2 = edges.some((edge) => {
      const isSource = edge.source === lb.id;
      const isTarget = edge.target === lb.id;
      if (isSource) {
        return getNodeType(edge.target) === "ec2";
      }
      if (isTarget) {
        return getNodeType(edge.source) === "ec2";
      }
      return false;
    });

    if (!isConnectedToEc2) {
      score -= 15;
      warnings.push({
        id: `lb-ec2-${lb.id}`,
        type: "error",
        message: `Load Balancer "${lb.data.label}" is not directing traffic to any EC2 Instance.`,
        rule: "Application Load Balancer must route incoming client requests to back-end compute resources.",
        affectedNodeIds: [lb.id],
      });
      recommendations.push({
        id: `lb-ec2-rec-${lb.id}`,
        message: `Link "${lb.data.label}" to your EC2 instances.`,
        action: "Connect the Load Balancer to one or more EC2 instances to act as target groups.",
      });
    }
  });

  // Rule 3: CloudFront must connect to S3 or Load Balancer
  const cfNodes = nodes.filter((n) => n.data.componentType === "cloudfront");
  cfNodes.forEach((cf) => {
    const isConnectedToOrigin = edges.some((edge) => {
      const isSource = edge.source === cf.id;
      const isTarget = edge.target === cf.id;
      if (isSource) {
        const targetType = getNodeType(edge.target);
        return targetType === "s3" || targetType === "load-balancer";
      }
      if (isTarget) {
        const sourceType = getNodeType(edge.source);
        return sourceType === "s3" || sourceType === "load-balancer";
      }
      return false;
    });

    if (!isConnectedToOrigin) {
      score -= 15;
      warnings.push({
        id: `cf-origin-${cf.id}`,
        type: "error",
        message: `CloudFront "${cf.data.label}" has no configured origin S3 bucket or Load Balancer.`,
        rule: "CloudFront distributions require a valid origin resource to fetch and cache content.",
        affectedNodeIds: [cf.id],
      });
      recommendations.push({
        id: `cf-origin-rec-${cf.id}`,
        message: `Connect "${cf.data.label}" to an origin.`,
        action: "Connect the CloudFront distribution to an S3 Bucket (static content) or Load Balancer (dynamic server API).",
      });
    }
  });

  // Rule 4: Detect isolated resources
  nodes.forEach((node) => {
    const isConnected = edges.some((edge) => edge.source === node.id || edge.target === node.id);
    if (!isConnected) {
      score -= 10;
      warnings.push({
        id: `isolated-${node.id}`,
        type: "warning",
        message: `Resource "${node.data.label}" (${getNodeLabel(node.id)}) is completely isolated.`,
        rule: "Orphaned AWS resources increase costs without providing infrastructure value.",
        affectedNodeIds: [node.id],
      });
      recommendations.push({
        id: `isolated-rec-${node.id}`,
        message: `Connect or clean up "${node.data.label}".`,
        action: "Connect this node to other architectural components, or delete it if it is obsolete.",
      });
    }
  });

  // Clamp health score between 0 and 100
  const finalScore = Math.max(0, Math.min(100, score));

  return {
    isValid: warnings.filter((w) => w.type === "error").length === 0,
    healthScore: finalScore,
    warnings,
    recommendations,
  };
}
