import type { NodeTypes } from "@xyflow/react";
import { AwsNode } from "./AwsNode";
import {
  Ec2Node,
  S3Node,
  RdsNode,
  LambdaNode,
  LoadBalancerNode,
  CloudFrontNode,
} from "./services";

export const nodeTypes: NodeTypes = {
  awsNode: AwsNode,
  ec2Node: Ec2Node,
  s3Node: S3Node,
  rdsNode: RdsNode,
  lambdaNode: LambdaNode,
  loadBalancerNode: LoadBalancerNode,
  cloudFrontNode: CloudFrontNode,
};
