resource "aws_security_group" "broken" {
  name = "broken

  ingress {
    from_port   = 22
    cidr_blocks = ["0.0.0.0/0"
  }
}

resource "aws_db_instance" "after_error" {
  publicly_accessible = true
