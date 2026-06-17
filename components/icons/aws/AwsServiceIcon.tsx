import type { AwsComponentType } from "@/types";
import { Ec2Icon } from "./Ec2Icon";
import { S3Icon } from "./S3Icon";
import { RdsIcon } from "./RdsIcon";
import { LambdaIcon } from "./LambdaIcon";
import { LoadBalancerIcon } from "./LoadBalancerIcon";
import { CloudFrontIcon } from "./CloudFrontIcon";
import type { AwsIconProps } from "./types";

const ICON_COMPONENTS = {
  ec2: Ec2Icon,
  s3: S3Icon,
  rds: RdsIcon,
  lambda: LambdaIcon,
  "load-balancer": LoadBalancerIcon,
  cloudfront: CloudFrontIcon,
} as const;

export interface AwsServiceIconProps extends AwsIconProps {
  service: AwsComponentType;
}

export function AwsServiceIcon({ service, ...props }: AwsServiceIconProps) {
  const Icon = ICON_COMPONENTS[service];
  return <Icon {...props} />;
}

export function getAwsIconComponent(service: AwsComponentType) {
  return ICON_COMPONENTS[service];
}
