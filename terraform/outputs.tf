# ─── Outputs ────────────────────────────────────────────────────────────────────
output "instance_id" {
  description = "EC2 Instance ID"
  value       = aws_instance.main.id
}

output "instance_public_ip" {
  description = "EC2 Instance Public IP"
  value       = aws_instance.main.public_ip
}

output "instance_public_dns" {
  description = "EC2 Instance Public DNS"
  value       = aws_instance.main.public_dns
}

output "elastic_ip" {
  description = "Elastic IP allocated to the instance"
  value       = aws_eip.instance.public_ip
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_instance.main.public_ip}"
}

output "db_secret_arn" {
  description = "Secrets Manager secret ARN for database credentials"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "security_group_id" {
  description = "Security Group ID"
  value       = aws_security_group.instance.id
}

output "instance_profile_arn" {
  description = "IAM Instance Profile ARN"
  value       = aws_iam_instance_profile.instance.arn
}

output "private_subnet_ids" {
  description = "Private Subnet IDs"
  value       = [aws_subnet.private_1.id, aws_subnet.private_2.id]
}

output "public_subnet_ids" {
  description = "Public Subnet IDs"
  value       = [aws_subnet.public_1.id, aws_subnet.public_2.id]
}