/**
 * Terraform addresses shared by the generator and the security engine, so a
 * finding can point at the exact resource block that implements the setting.
 */
export const tfAddress = {
  vpc: () => "aws_vpc.main",
  flowLog: () => "aws_flow_log.main",
  instance: (n: string) => `aws_instance.${n}`,
  securityGroup: (n: string) => `aws_security_group.${n}`,
  customIngress: (n: string, index: number) => `aws_vpc_security_group_ingress_rule.${n}_custom_${index + 1}`,
  dbInstance: (n: string) => `aws_db_instance.${n}`,
  bucket: (n: string) => `aws_s3_bucket.${n}`,
  bucketPublicAccessBlock: (n: string) => `aws_s3_bucket_public_access_block.${n}`,
  bucketEncryption: (n: string) => `aws_s3_bucket_server_side_encryption_configuration.${n}`,
  bucketVersioning: (n: string) => `aws_s3_bucket_versioning.${n}`,
  lambda: (n: string) => `aws_lambda_function.${n}`,
  lambdaRole: (n: string) => `aws_iam_role.${n}_lambda`,
  lambdaExtraPolicy: (n: string) => `aws_iam_role_policy.${n}_extra`,
  loadBalancer: (n: string) => `aws_lb.${n}`,
  httpListener: (n: string) => `aws_lb_listener.${n}_http`,
  distribution: (n: string) => `aws_cloudfront_distribution.${n}`,
} as const;
