import type { AwsComponentDefinition, AwsComponentType } from "@/types";

export const AWS_COMPONENTS: AwsComponentDefinition[] = [
  {
    type: "ec2",
    label: "Amazon EC2",
    description: "Scalable compute capacity in the cloud",
    category: "compute",
    color: "#FF9900",
    defaultLabel: "EC2 Instance",
    nodeType: "ec2Node",
  },
  {
    type: "s3",
    label: "Amazon S3",
    description: "Object storage built to store and retrieve any amount of data",
    category: "storage",
    color: "#569A31",
    defaultLabel: "S3 Bucket",
    nodeType: "s3Node",
  },
  {
    type: "rds",
    label: "Amazon RDS",
    description: "Managed relational database service",
    category: "database",
    color: "#3B48CC",
    defaultLabel: "RDS Database",
    nodeType: "rdsNode",
  },
  {
    type: "lambda",
    label: "AWS Lambda",
    description: "Run code without provisioning or managing servers",
    category: "serverless",
    color: "#FF9900",
    defaultLabel: "Lambda Function",
    nodeType: "lambdaNode",
  },
  {
    type: "load-balancer",
    label: "Elastic Load Balancing",
    description: "Distribute incoming traffic across multiple targets",
    category: "networking",
    color: "#8C4FFF",
    defaultLabel: "Application Load Balancer",
    nodeType: "loadBalancerNode",
  },
  {
    type: "cloudfront",
    label: "Amazon CloudFront",
    description: "Fast content delivery network (CDN) service",
    category: "networking",
    color: "#8C4FFF",
    defaultLabel: "CloudFront Distribution",
    nodeType: "cloudFrontNode",
  },
];

export const AWS_COMPONENT_MAP = Object.fromEntries(
  AWS_COMPONENTS.map((c) => [c.type, c])
) as Record<string, AwsComponentDefinition>;

export const CATEGORY_LABELS: Record<AwsComponentDefinition["category"], string> = {
  compute: "Compute",
  storage: "Storage",
  database: "Database",
  serverless: "Serverless",
  networking: "Networking & Content Delivery",
};

export function getComponentDefinition(type: string): AwsComponentDefinition | undefined {
  return AWS_COMPONENT_MAP[type];
}

export function getNodeTypeForComponent(type: AwsComponentType): string {
  return AWS_COMPONENT_MAP[type]?.nodeType ?? "awsNode";
}

export function getComponentsByCategory(): Record<string, AwsComponentDefinition[]> {
  return AWS_COMPONENTS.reduce<Record<string, AwsComponentDefinition[]>>((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {});
}
