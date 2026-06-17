"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import {
  Ec2Node,
  S3Node,
  RdsNode,
  LambdaNode,
  LoadBalancerNode,
  CloudFrontNode,
} from "./services";

/** Fallback router for legacy saved nodes with type "awsNode" */
function AwsNodeRouter({ data, selected, ...props }: NodeProps) {
  const nodeData = data as AwsNodeData;

  switch (nodeData.componentType) {
    case "ec2":
      return <Ec2Node data={data} selected={selected} {...props} />;
    case "s3":
      return <S3Node data={data} selected={selected} {...props} />;
    case "rds":
      return <RdsNode data={data} selected={selected} {...props} />;
    case "lambda":
      return <LambdaNode data={data} selected={selected} {...props} />;
    case "load-balancer":
      return <LoadBalancerNode data={data} selected={selected} {...props} />;
    case "cloudfront":
      return <CloudFrontNode data={data} selected={selected} {...props} />;
    default:
      return <Ec2Node data={data} selected={selected} {...props} />;
  }
}

export const AwsNode = memo(AwsNodeRouter);
