resource "aws_db_instance" "legacy" {
  identifier                  = "cs-fixture-legacy"
  engine                      = "mysql"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "app_admin"
  manage_master_user_password = true
  publicly_accessible         = true
  storage_encrypted           = false
  backup_retention_period     = 0
  skip_final_snapshot         = true
}

resource "aws_db_instance" "defaults" {
  identifier                  = "cs-fixture-defaults"
  engine                      = "postgres"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "app_admin"
  manage_master_user_password = true
  skip_final_snapshot         = true
}
