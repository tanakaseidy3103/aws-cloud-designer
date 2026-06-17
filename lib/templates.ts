import type { Edge, Node } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { getNodeTypeForComponent } from "./aws-components";
import { DEFAULT_REGION } from "./constants";

export interface ArchitectureTemplate {
  id: string;
  name: string;
  description: string;
  nodes: Node<AwsNodeData>[];
  edges: Edge[];
}

// Helper to construct a node configuration
function createTemplateNode(
  id: string,
  type: "ec2" | "s3" | "rds" | "lambda" | "load-balancer" | "cloudfront",
  label: string,
  x: number,
  y: number,
  extraData?: Partial<AwsNodeData>
): Node<AwsNodeData> {
  return {
    id,
    type: getNodeTypeForComponent(type),
    position: { x, y },
    data: {
      componentType: type,
      label,
      description: `${label} initialized by template.`,
      region: DEFAULT_REGION,
      ...extraData,
    },
  };
}

export const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  {
    id: "3-tier-web-app",
    name: "3-Tier Web App",
    description: "Standard web application setup using CloudFront, Application Load Balancer, EC2 servers, and RDS Database.",
    nodes: [
      createTemplateNode("cf-1", "cloudfront", "CloudFront CDN", 50, 200),
      createTemplateNode("alb-1", "load-balancer", "Application Load Balancer", 280, 200),
      createTemplateNode("ec2-web-1", "ec2", "Web Server 1", 520, 100, { instanceType: "t3.medium" }),
      createTemplateNode("ec2-web-2", "ec2", "Web Server 2", 520, 300, { instanceType: "t3.medium" }),
      createTemplateNode("rds-db", "rds", "Postgres RDS Cluster", 780, 200, { instanceType: "db.m6g.large" }),
    ],
    edges: [
      {
        id: "e-cf-alb",
        source: "cf-1",
        target: "alb-1",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-alb-ec2-1",
        source: "alb-1",
        target: "ec2-web-1",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-alb-ec2-2",
        source: "alb-1",
        target: "ec2-web-2",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-ec2-1-rds",
        source: "ec2-web-1",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-ec2-2-rds",
        source: "ec2-web-2",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
    ],
  },
  {
    id: "serverless",
    name: "Serverless Application",
    description: "Highly scalable serverless stack: CloudFront static frontend in S3 and Lambda API back-end speaking to RDS database.",
    nodes: [
      createTemplateNode("cf-1", "cloudfront", "CloudFront distribution", 50, 200),
      createTemplateNode("s3-frontend", "s3", "Web App S3 Bucket", 280, 100),
      createTemplateNode("lambda-api", "lambda", "Web App Lambda API", 280, 300),
      createTemplateNode("rds-db", "rds", "Aurora Serverless v2 RDS", 520, 300, { instanceType: "db.serverless" }),
    ],
    edges: [
      {
        id: "e-cf-s3",
        source: "cf-1",
        target: "s3-frontend",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-cf-lambda",
        source: "cf-1",
        target: "lambda-api",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-lambda-rds",
        source: "lambda-api",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
    ],
  },
  {
    id: "static-website",
    name: "Static Website (S3 + CloudFront)",
    description: "Fast content delivery network architecture to serve a static frontend securely from an S3 bucket origin.",
    nodes: [
      createTemplateNode("cf-1", "cloudfront", "CloudFront CDN Distribution", 100, 200),
      createTemplateNode("s3-web", "s3", "Static Web hosting S3 Bucket", 380, 200),
    ],
    edges: [
      {
        id: "e-cf-s3-static",
        source: "cf-1",
        target: "s3-web",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
    ],
  },
  {
    id: "microservices",
    name: "Microservices Stack",
    description: "Load Balancer dispatching user requests to isolated EC2 microservice APIs querying a central Database cluster.",
    nodes: [
      createTemplateNode("alb-1", "load-balancer", "API Gateway ALB", 50, 220),
      createTemplateNode("ec2-auth", "ec2", "Auth Service EC2", 280, 80, { instanceType: "t3.small" }),
      createTemplateNode("ec2-catalog", "ec2", "Catalog Service EC2", 280, 220, { instanceType: "t3.small" }),
      createTemplateNode("ec2-orders", "ec2", "Orders Service EC2", 280, 360, { instanceType: "t3.small" }),
      createTemplateNode("rds-db", "rds", "Shared RDS DB", 520, 220, { instanceType: "db.t3.medium" }),
    ],
    edges: [
      {
        id: "e-alb-auth",
        source: "alb-1",
        target: "ec2-auth",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-alb-catalog",
        source: "alb-1",
        target: "ec2-catalog",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-alb-orders",
        source: "alb-1",
        target: "ec2-orders",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-auth-rds",
        source: "ec2-auth",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-catalog-rds",
        source: "ec2-catalog",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
      {
        id: "e-orders-rds",
        source: "ec2-orders",
        target: "rds-db",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#ff9900", strokeWidth: 2 },
      },
    ],
  },
];
