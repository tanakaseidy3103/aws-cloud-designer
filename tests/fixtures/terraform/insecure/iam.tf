data "aws_iam_policy_document" "admin_like" {
  statement {
    effect    = "Allow"
    actions   = ["*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "admin_like" {
  name   = "cs-fixture-admin-like"
  policy = data.aws_iam_policy_document.admin_like.json
}

resource "aws_iam_policy" "s3_wildcard" {
  name = "cs-fixture-s3-wildcard"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:*", "ec2:DescribeInstances"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "not_action" {
  name   = "cs-fixture-not-action"
  role   = "cs-fixture-role"
  policy = <<-JSON
    {
      "Version": "2012-10-17",
      "Statement": [
        { "Effect": "Allow", "NotAction": "iam:*", "Resource": "*" }
      ]
    }
  JSON
}

resource "aws_iam_role_policy_attachment" "admin" {
  role       = "cs-fixture-role"
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
