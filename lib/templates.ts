import type { Edge, Node } from "@xyflow/react";
import type { AwsComponentType, AwsNodeData } from "@/types";
import { getNodeTypeForComponent } from "./aws-components";
import { DEFAULT_REGION } from "./constants";

export interface ArchitectureTemplate {
  id: string;
  name: string;
  description: string;
  /** Marks intentionally insecure designs used by the demo scenarios. */
  scenario?: string;
  nodes: Node<AwsNodeData>[];
  edges: Edge[];
}

function n(
  id: string,
  type: AwsComponentType,
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

function e(source: string, target: string): Edge {
  return {
    id: `e-${source}--${target}`,
    source,
    target,
    type: "smoothstep",
    animated: true,
    style: { stroke: "#ff9900", strokeWidth: 2 },
  };
}

/**
 * Every template must validate without errors and generate Terraform that
 * passes `terraform validate` (enforced by tests). Instance sizes are the
 * smallest that make sense, to keep accidental deployments cheap.
 */
export const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  {
    id: "3-tier-web-app",
    name: "3-Tier Web App",
    description: "CloudFront → internet-facing ALB → two private EC2 instances → PostgreSQL RDS. The ALB only accepts traffic from CloudFront.",
    nodes: [
      n("cf-1", "cloudfront", "CloudFront CDN", 50, 200),
      n("alb-1", "load-balancer", "Application Load Balancer", 280, 200),
      n("ec2-web-1", "ec2", "Web Server 1", 520, 100, { instanceType: "t3.micro" }),
      n("ec2-web-2", "ec2", "Web Server 2", 520, 300, { instanceType: "t3.micro" }),
      n("rds-db", "rds", "Postgres RDS", 780, 200, { instanceType: "db.t4g.micro" }),
    ],
    edges: [e("cf-1", "alb-1"), e("alb-1", "ec2-web-1"), e("alb-1", "ec2-web-2"), e("ec2-web-1", "rds-db"), e("ec2-web-2", "rds-db")],
  },
  {
    id: "serverless",
    name: "Serverless API",
    description: "Static frontend in S3 behind CloudFront, and a Lambda API behind an ALB that reads/writes an RDS database and an uploads bucket.",
    nodes: [
      n("cf-1", "cloudfront", "Frontend CDN", 50, 100),
      n("s3-frontend", "s3", "Frontend Bucket", 300, 100),
      n("alb-api", "load-balancer", "API Load Balancer", 50, 320),
      n("lambda-api", "lambda", "API Function", 300, 320),
      n("rds-db", "rds", "App Database", 560, 260, { instanceType: "db.t4g.micro" }),
      n("s3-uploads", "s3", "Uploads Bucket", 560, 400),
    ],
    edges: [e("cf-1", "s3-frontend"), e("alb-api", "lambda-api"), e("lambda-api", "rds-db"), e("lambda-api", "s3-uploads")],
  },
  {
    id: "static-website",
    name: "Static Website (S3 + CloudFront)",
    description: "Private S3 bucket served only through CloudFront with Origin Access Control.",
    nodes: [n("cf-1", "cloudfront", "CloudFront CDN Distribution", 100, 200), n("s3-web", "s3", "Static Site Bucket", 380, 200)],
    edges: [e("cf-1", "s3-web")],
  },
  {
    id: "microservices",
    name: "Microservices Stack",
    description: "Internet-facing ALB in front of three EC2 services that share one RDS database.",
    nodes: [
      n("alb-1", "load-balancer", "Gateway ALB", 50, 220),
      n("ec2-auth", "ec2", "Auth Service", 280, 80, { instanceType: "t3.micro" }),
      n("ec2-catalog", "ec2", "Catalog Service", 280, 220, { instanceType: "t3.micro" }),
      n("ec2-orders", "ec2", "Orders Service", 280, 360, { instanceType: "t3.micro" }),
      n("rds-db", "rds", "Shared RDS DB", 520, 220, { instanceType: "db.t4g.micro" }),
    ],
    edges: [
      e("alb-1", "ec2-auth"),
      e("alb-1", "ec2-catalog"),
      e("alb-1", "ec2-orders"),
      e("ec2-auth", "rds-db"),
      e("ec2-catalog", "rds-db"),
      e("ec2-orders", "rds-db"),
    ],
  },
  {
    id: "scenario-insecure-ssh",
    name: "Scenario 1: SSH Open to the Internet",
    scenario: "1",
    description:
      "Deliberately insecure: a web server in a public subnet with SSH (22) open to 0.0.0.0/0. Open the Security tab to see the findings and their evidence.",
    nodes: [
      n("alb-1", "load-balancer", "Public ALB", 50, 200),
      n("ec2-web", "ec2", "Web Server", 300, 200, {
        instanceType: "t3.micro",
        config: {
          subnetTier: "public",
          ingressRules: [{ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0", description: "SSH for admins" }],
        },
      }),
      n("rds-db", "rds", "App Database", 560, 200, { instanceType: "db.t4g.micro" }),
    ],
    edges: [e("alb-1", "ec2-web"), e("ec2-web", "rds-db")],
  },
];
