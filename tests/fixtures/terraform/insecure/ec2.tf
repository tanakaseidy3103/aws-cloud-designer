resource "aws_instance" "imds_v1" {
  ami                         = "ami-00000000000000000"
  instance_type               = "t3.micro"
  associate_public_ip_address = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "optional"
  }

  root_block_device {
    encrypted = false
  }
}

resource "aws_instance" "no_metadata_options" {
  ami           = "ami-00000000000000000"
  instance_type = "t3.micro"
}

resource "aws_ebs_volume" "data" {
  availability_zone = "us-east-1a"
  size              = 10
}

resource "aws_efs_file_system" "shared" {
  creation_token = "cs-fixture"
}
