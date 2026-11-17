# Every security-relevant value here comes from a variable or expression.
# The analyzer must not report these as secure or insecure: each one is an
# unresolved check.

variable "db_public" {
  type    = bool
  default = true
}

variable "allowed_cidrs" {
  type = list(string)
}

variable "imds_tokens" {
  type    = string
  default = "required"
}

variable "admin_actions" {
  type    = list(string)
  default = ["*"]
}

variable "policy_arn" {
  type = string
}

resource "aws_db_instance" "app" {
  identifier                  = "cs-fixture-unresolved"
  engine                      = "postgres"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "app_admin"
  manage_master_user_password = true
  publicly_accessible         = var.db_public
  storage_encrypted           = true
  deletion_protection         = true
  skip_final_snapshot         = true
}

resource "aws_security_group" "app" {
  name        = "app"
  description = "Rules from variables"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
}

resource "aws_instance" "app" {
  ami           = "ami-00000000000000000"
  instance_type = "t3.micro"

  metadata_options {
    http_tokens = var.imds_tokens
  }

  root_block_device {
    encrypted = true
  }
}

data "aws_iam_policy_document" "dynamic" {
  statement {
    actions   = var.admin_actions
    resources = ["*"]
  }
}

resource "aws_iam_role_policy_attachment" "maybe_admin" {
  role       = "cs-fixture-role"
  policy_arn = var.policy_arn
}
