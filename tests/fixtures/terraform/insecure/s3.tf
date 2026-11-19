# Deliberately insecure fixture for the CloudSentinel Terraform analyzer.

resource "aws_s3_bucket" "public_site" {
  bucket = "cs-fixture-public-site"
}

resource "aws_s3_bucket_acl" "public_site" {
  bucket = aws_s3_bucket.public_site.id
  acl    = "public-read"
}

resource "aws_s3_bucket_policy" "public_site" {
  bucket = aws_s3_bucket.public_site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.public_site.arn}/*"
      },
    ]
  })
}

resource "aws_s3_bucket" "half_blocked" {
  bucket = "cs-fixture-half-blocked"
}

resource "aws_s3_bucket_public_access_block" "half_blocked" {
  bucket                  = aws_s3_bucket.half_blocked.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = true
}
