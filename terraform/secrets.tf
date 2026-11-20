# ─── Secrets Manager & SSM Parameters ───────────────────────────────────────────
# Random password for database
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Secrets Manager secret for DB credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "DbSecret"
  description = "Database credentials for Todo App"
  tags = {
    Name = "TodoAppEc2Stack/DbSecret"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = "todo_user"
    password = random_password.db_password.result
    engine   = "postgres"
    host     = "localhost"
    port     = 5432
    dbname   = "todo_app_aws_ec2_db"
  })
}

# SSM Parameters for application configuration
resource "aws_ssm_parameter" "db_name" {
  name  = "/todo-app/db/name"
  type  = "String"
  value = "todo_app_aws_ec2_db"
  tags = {
    Name = "TodoAppEc2Stack/DbName"
  }
}

resource "aws_ssm_parameter" "db_port" {
  name  = "/todo-app/db/port"
  type  = "String"
  value = "5432"
  tags = {
    Name = "TodoAppEc2Stack/DbPort"
  }
}

resource "aws_ssm_parameter" "api_url" {
  name  = "/todo-app/frontend/api-url"
  type  = "String"
  value = "/api"
  tags = {
    Name = "TodoAppEc2Stack/ReactApiUrl"
  }
}