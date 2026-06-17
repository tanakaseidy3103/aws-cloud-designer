import type { Edge, Node } from "@xyflow/react";
import type { AwsNodeData, TerraformOutput } from "@/types";

// Helper to sanitize resource name for Terraform (a-z, 0-9, _)
function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_");
}

export function generateTerraform(
  architectureId: string,
  nodes: Node<AwsNodeData>[],
  edges: Edge[]
): TerraformOutput {
  const sanitizeNodeIdMap: Record<string, string> = {};
  nodes.forEach((n) => {
    const rawName = sanitize(n.data.label);
    const shortId = n.id.slice(0, 4);
    sanitizeNodeIdMap[n.id] = `${rawName}_${shortId}`;
  });

  // Check if we need general security groups
  const hasEc2 = nodes.some((n) => n.data.componentType === "ec2");
  const hasRds = nodes.some((n) => n.data.componentType === "rds");
  const hasLambda = nodes.some((n) => n.data.componentType === "lambda");

  let mainTf = `# Terraform Config Generated for Architecture: ${architectureId}
# Total AWS Components: ${nodes.length}

`;

  // 1. Generate Security Groups if needed
  if (hasEc2 || hasRds) {
    mainTf += `# Security Groups
resource "aws_security_group" "ec2_sg" {
  name        = "ec2-app-sg"
  description = "Security group for EC2 Web/App instances"
  vpc_id      = "vpc-default"

  ingress {
    description = "HTTP Traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

`;

    if (hasRds) {
      mainTf += `resource "aws_security_group" "rds_sg" {
  name        = "rds-db-sg"
  description = "Security group for Relational Database"
  vpc_id      = "vpc-default"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

`;
    }
  }

  // 2. Generate IAM roles for Lambdas if needed
  if (hasLambda) {
    mainTf += `# IAM Roles for Lambda functions
resource "aws_iam_role" "lambda_exec_role" {
  name = "lambda-execution-role-${architectureId.slice(0, 8)}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

`;
  }

  // 3. Generate individual AWS resources
  nodes.forEach((node) => {
    const componentType = node.data.componentType;
    const name = sanitizeNodeIdMap[node.id];
    const label = node.data.label;

    mainTf += `# AWS Component: ${label}\n`;

    switch (componentType) {
      case "ec2":
        mainTf += `resource "aws_instance" "${name}" {
  ami           = "ami-0c55b159cbfafe1f0" # Amazon Linux 2 in us-east-1
  instance_type = "${node.data.instanceType || "t3.micro"}"
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]

  tags = {
    Name        = "${label}"
    Environment = "production"
  }
}

`;
        break;

      case "s3":
        mainTf += `resource "aws_s3_bucket" "${name}" {
  bucket        = "bucket-${name.replace(/_/g, "-")}"
  force_destroy = true

  tags = {
    Name = "${label}"
  }
}

# Block public access configuration
resource "aws_s3_bucket_public_access_block" "${name}_block" {
  bucket = aws_s3_bucket.${name}.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

`;
        break;

      case "rds":
        mainTf += `resource "aws_db_instance" "${name}" {
  allocated_storage      = 20
  max_allocated_storage  = 100
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = "${node.data.instanceType || "db.t3.micro"}"
  db_name                = "appdb"
  username               = "postgres"
  password               = "password_please_change_me_123"
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  skip_final_snapshot    = true

  tags = {
    Name = "${label}"
  }
}

`;
        break;

      case "lambda":
        mainTf += `resource "aws_lambda_function" "${name}" {
  filename      = "lambda_function_payload.zip"
  function_name = "${name}"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  environment {
    variables = {
      NODE_ENV = "production"
    }
  }

  tags = {
    Name = "${label}"
  }
}

`;
        break;

      case "load-balancer":
        mainTf += `resource "aws_lb" "${name}" {
  name               = "alb-${name.replace(/_/g, "-").slice(0, 28)}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg_${name}.id]
  subnets            = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]

  tags = {
    Name = "${label}"
  }
}

resource "aws_security_group" "alb_sg_${name}" {
  name        = "alb-${name.replace(/_/g, "-")}-sg"
  description = "ALB ingress/egress SG"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb_target_group" "tg_${name}" {
  name     = "tg-${name.replace(/_/g, "-").slice(0, 28)}"
  port     = 80
  protocol = "HTTP"
  vpc_id   = "vpc-default"
}

resource "aws_lb_listener" "listener_${name}" {
  load_balancer_arn = aws_lb.${name}.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tg_${name}.arn
  }
}

`;
        break;

      case "cloudfront":
        // Find if this CloudFront node connects to an S3 or Load Balancer node
        const originEdges = edges.filter((e) => e.source === node.id || e.target === node.id);
        let originBlock = "";
        let targetOriginId = "default-origin";

        const connectedS3 = originEdges.find((e) => {
          const neighbor = e.source === node.id ? e.target : e.source;
          return nodes.find((n) => n.id === neighbor)?.data.componentType === "s3";
        });

        const connectedAlb = originEdges.find((e) => {
          const neighbor = e.source === node.id ? e.target : e.source;
          return nodes.find((n) => n.id === neighbor)?.data.componentType === "load-balancer";
        });

        if (connectedS3) {
          const s3Id = connectedS3.source === node.id ? connectedS3.target : connectedS3.source;
          const s3Name = sanitizeNodeIdMap[s3Id];
          targetOriginId = `s3-${s3Name}`;
          originBlock = `  origin {
    domain_name              = aws_s3_bucket.${s3Name}.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.cf_oac_${name}.id
    origin_id                = "${targetOriginId}"
  }

  resource "aws_cloudfront_origin_access_control" "cf_oac_${name}" {
    name                              = "oac-${name.replace(/_/g, "-")}"
    description                       = "OAC for S3 distribution origin"
    origin_access_control_origin_type = "s3"
    signing_behavior                  = "always"
    signing_protocol                  = "sigv4"
  }`;
        } else if (connectedAlb) {
          const albId = connectedAlb.source === node.id ? connectedAlb.target : connectedAlb.source;
          const albName = sanitizeNodeIdMap[albId];
          targetOriginId = `alb-${albName}`;
          originBlock = `  origin {
    domain_name = aws_lb.${albName}.dns_name
    origin_id   = "${targetOriginId}"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
    }
  }`;
        } else {
          originBlock = `  origin {
    domain_name = "s3-static-website-origin.s3.amazonaws.com"
    origin_id   = "${targetOriginId}"
  }`;
        }

        mainTf += `resource "aws_cloudfront_distribution" "${name}" {
${originBlock}

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "${targetOriginId}"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "${label}"
  }
}

`;
        break;
    }
  });

  // 4. Generate Connector / Edge HCL definitions
  let sgRulesHcl = "";
  let tgAttachmentsHcl = "";

  edges.forEach((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) return;

    const sourceName = sanitizeNodeIdMap[sourceNode.id];
    const targetName = sanitizeNodeIdMap[targetNode.id];

    // EC2 connecting to RDS Database
    if (
      (sourceNode.data.componentType === "ec2" && targetNode.data.componentType === "rds") ||
      (sourceNode.data.componentType === "rds" && targetNode.data.componentType === "ec2")
    ) {
      sgRulesHcl += `# Connection: EC2 <=> RDS SG rule for Postgres
resource "aws_security_group_rule" "ec2_to_rds_${edge.id.slice(0, 8)}" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds_sg.id
  source_security_group_id = aws_security_group.ec2_sg.id
}

`;
    }

    // Load Balancer connecting to EC2 Instance (routing targets)
    if (sourceNode.data.componentType === "load-balancer" && targetNode.data.componentType === "ec2") {
      tgAttachmentsHcl += `# Route: Load Balancer target group attachment to EC2 Instance
resource "aws_lb_target_group_attachment" "tg_attach_${edge.id.slice(0, 8)}" {
  target_group_arn = aws_lb_target_group.tg_${sourceName}.arn
  target_id        = aws_instance.${targetName}.id
  port             = 80
}

`;
    }
  });

  if (sgRulesHcl) {
    mainTf += `# Security Group Rule Connections\n${sgRulesHcl}`;
  }
  if (tgAttachmentsHcl) {
    mainTf += `# ALB Target Group Attachments\n${tgAttachmentsHcl}`;
  }

  // Generate outputs.tf
  let outputsTf = `# Outputs declarations\n\n`;
  nodes.forEach((n) => {
    const name = sanitizeNodeIdMap[n.id];
    const label = n.data.label;
    if (n.data.componentType === "ec2") {
      outputsTf += `output "${name}_public_ip" {
  description = "Public IP of EC2 Instance: ${label}"
  value       = aws_instance.${name}.public_ip
}

`;
    } else if (n.data.componentType === "load-balancer") {
      outputsTf += `output "${name}_dns_name" {
  description = "DNS name of ALB: ${label}"
  value       = aws_lb.${name}.dns_name
}

`;
    } else if (n.data.componentType === "cloudfront") {
      outputsTf += `output "${name}_domain_name" {
  description = "Domain name of CloudFront distribution: ${label}"
  value       = aws_cloudfront_distribution.${name}.domain_name
}

`;
    } else if (n.data.componentType === "s3") {
      outputsTf += `output "${name}_bucket_arn" {
  description = "S3 Bucket ARN: ${label}"
  value       = aws_s3_bucket.${name}.arn
}

`;
    }
  });

  const variablesTf = `# Variables declarations

variable "aws_region" {
  type        = string
  description = "AWS deployment region"
  default     = "${nodes[0]?.data.region ?? "us-east-1"}"
}
`;

  const providersTf = `# Providers configurations

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
`;

  return {
    architectureId,
    provider: "aws",
    files: {
      "main.tf": mainTf,
      "providers.tf": providersTf,
      "variables.tf": variablesTf,
      "outputs.tf": outputsTf,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function isTerraformGenerationEnabled(): boolean {
  return true;
}
