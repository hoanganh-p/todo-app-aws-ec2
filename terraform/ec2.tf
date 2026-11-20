# ─── EC2 Instance ───────────────────────────────────────────────────────────────
# Data source for latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# Data source for Key Pair
data "aws_key_pair" "deploy_key" {
  key_name = var.key_pair_name
}

# Elastic IP for the instance
resource "aws_eip" "instance" {
  domain = "vpc"
  instance = aws_instance.main.id

  tags = {
    Name = "TodoAppEc2Stack/InstanceEIP"
  }
}

# EC2 Instance
resource "aws_instance" "main" {
  ami                         = data.aws_ami.amazon_linux_2023.id
  instance_type               = var.instance_type
  key_name                    = var.key_pair_name
  subnet_id                   = aws_subnet.public_1.id
  vpc_security_group_ids      = [aws_security_group.instance.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  user_data_replace_on_change = true

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    ecr_repository_id = var.ecr_repository_id
    db_secret_arn     = aws_secretsmanager_secret.db_credentials.arn
  })

  tags = {
    Name = "TodoAppEc2Stack/Instance"
  }

  # Ensure dependencies are created first
  depends_on = [
    aws_nat_gateway.main,
    aws_secretsmanager_secret_version.db_credentials,
    aws_ssm_parameter.db_name,
    aws_ssm_parameter.db_port,
    aws_ssm_parameter.api_url,
  ]
}