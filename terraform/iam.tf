# ─── IAM ────────────────────────────────────────────────────────────────────────
# IAM Role for EC2 Instance
resource "aws_iam_role" "instance" {
  name = "TodoAppEc2Stack-InstanceRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "TodoAppEc2Stack/InstanceRole"
  }
}

# Attach AWS Managed Policies
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# Inline Policy for Secrets Manager access
resource "aws_iam_role_policy" "secrets" {
  name = "TodoAppEc2Stack-InstanceRole-SecretsAccess"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowReadSecretsManagerSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.db_credentials.arn
      },
      {
        Sid    = "AllowListSecrets"
        Effect = "Allow"
        Action = "secretsmanager:ListSecrets"
        Resource = "*"
      }
    ]
  })
}

# Inline Policy for SSM Parameter Store access
resource "aws_iam_role_policy" "ssm_params" {
  name = "TodoAppEc2Stack-InstanceRole-SSMParamsAccess"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowReadSSMParameters"
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ]
      Resource = [
        "arn:aws:ssm:us-east-1:262232992721:parameter/todo-app/*"
      ]
    }]
  })
}

# Instance Profile
resource "aws_iam_instance_profile" "instance" {
  name = "TodoAppEc2Stack-InstanceProfile"
  role = aws_iam_role.instance.name
}