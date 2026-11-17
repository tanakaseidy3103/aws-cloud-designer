resource "aws_security_group" "bastion" {
  name        = "bastion"
  description = "Insecure bastion"

  ingress {
    description = "SSH from anywhere"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description      = "RDP from anywhere (IPv6)"
    from_port        = 3389
    to_port          = 3389
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_security_group" "wide_open" {
  name        = "wide-open"
  description = "Everything"
}

resource "aws_vpc_security_group_ingress_rule" "all_traffic" {
  security_group_id = aws_security_group.wide_open.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group_rule" "postgres_public" {
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  cidr_blocks       = ["10.0.0.0/8", "0.0.0.0/0"]
  security_group_id = aws_security_group.wide_open.id
}

resource "aws_vpc_security_group_ingress_rule" "app_port" {
  security_group_id = aws_security_group.wide_open.id
  ip_protocol       = "tcp"
  from_port         = 8080
  to_port           = 8080
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "https_ok" {
  security_group_id = aws_security_group.wide_open.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_subnet" "public" {
  vpc_id                  = "vpc-00000000000000000"
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}
