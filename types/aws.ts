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

export interface AwsNodeData extends Record<string, unknown> {
  componentType: AwsComponentType;
  label: string;
  description?: string;
  instanceType?: string;
  region?: string;
}

export interface ComponentPaletteItem extends AwsComponentDefinition {
  draggable: true;
}
