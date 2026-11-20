# Todo Application - AWS EC2 Deployment

A Todo REST API built with Golang and PostgreSQL, with a focus on Linux server administration, containerization, cloud deployment, and DevOps automation.

The project aims to demonstrate practical experience in developing, deploying, and operating a web application on AWS infrastructure.

## Architecture


## Tech Stack

| Category | Technology |
|---|---|
| Backend | Golang 1.24 |
| Database | PostgreSQL 15 |
| Cloud Platform | AWS |
| Compute | Amazon EC2 (t3.micro) |
| Operating System | Amazon Linux 2023 |
| Containerization | Docker |
| Container Orchestration | Docker Compose v2 |
| Web Server | Nginx (reverse proxy + static files) |
| IaC | Terraform |
| CI/CD | GitHub Actions (OIDC) |
| Monitoring | Amazon CloudWatch Agent |
| Secrets | AWS Secrets Manager |
| Config | AWS SSM Parameter Store |

## Project Structure

```
todo-app-aws-ec2/
├── backend/                 # Go REST API
│   ├── Dockerfile           # Dev (hot reload)
│   ├── Dockerfile.prod      # Production multi-stage
│   ├── main.go
│   ├── handlers/
│   ├── database/
│   └── models/
├── frontend/                # React + Nginx
│   ├── Dockerfile           # Dev (hot reload)
│   ├── Dockerfile.prod      # Production multi-stage
│   ├── nginx/
│   └── src/
├── terraform/               # Terraform IaC
│   ├── versions.tf          # Provider & backend config
│   ├── variables.tf         # Input variables
│   ├── vpc.tf              # VPC, subnets, NAT Gateway
│   ├── security.tf         # Security groups
│   ├── iam.tf              # IAM roles & policies
│   ├── secrets.tf          # Secrets Manager & SSM
│   ├── ec2.tf              # EC2 instance & EIP
│   ├── cloudwatch.tf       # CloudWatch logs & dashboard
│   ├── outputs.tf          # Output values
│   └── user_data.sh.tftpl  # Instance user data script
├── .github/workflows/       # CI/CD pipelines
│   ├── ci.yml              # Build & Test
│   ├── cd.yml              # Deploy
│   └── destroy.yml         # Teardown
├── docker-compose.yml       # Local development
├── docker-compose.prod.yml  # Production
└── README.md
```

## Quick Start (Local Development)

```bash
# Clone and enter project
git clone <your-repo>
cd todo-app-aws-ec2

# Copy environment template
cp .env.example .env
# Edit .env with your values

# Start all services with hot reload
docker compose up -d

# Access:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8080
# Adminer (DB UI): http://localhost:8081
```

## AWS Deployment (Production)

### Prerequisites

1. **AWS Account** with appropriate permissions
2. **EC2 Key Pair** created in target region (us-east-1)
3. **GitHub OIDC Role** for CI/CD (see below)
4. **ECR Public Repositories** created:
   - `todo-app-backend`
   - `todo-app-frontend`
5. **Terraform State Backend** (S3 bucket + DynamoDB table) - created on first run

### 1. Create GitHub OIDC Role

Create IAM role `GitHubActionsDeployRole` with trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::262232992721:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringLike": {
        "token.actions.githubusercontent.com:job_workflow_ref": "YOUR_GITHUB_USERNAME/todo-app-aws-ec2/.github/workflows/*.yml@refs/heads/main"
      }
    }
  }]
}
```

Attach the policy from `trust-policy.json` (or create inline policy with required permissions for EC2, VPC, IAM, Secrets Manager, SSM, CloudWatch, ECR Public).

### 2. Create ECR Public Repositories

```bash
aws ecr-public create-repository --repository-name todo-app-backend --region us-east-1
aws ecr-public create-repository --repository-name todo-app-frontend --region us-east-1
```

Note the **registry ID** from output (e.g., `j1e7s5i4`) - this is your ECR_REPOSITORY variable.

### 3. Configure GitHub Repository

**Secrets (Settings → Secrets and variables → Actions → Secrets):**
- `EC2_SSH_PRIVATE_KEY` — Private key for EC2 key pair (PEM format)

**Variables (Settings → Secrets and variables → Actions → Variables):**
- `KEY_PAIR_NAME` — Name of your EC2 key pair (e.g., `todo-app-key`)
- `ECR_REPOSITORY` — Your ECR public registry ID (e.g., `j1e7s5i4`)

### 4. Update docker-compose.prod.yml for ECR

```yaml
backend:
  image: public.ecr.aws/${ECR_REPOSITORY}/todo-app-backend:latest
frontend:
  image: public.ecr.aws/${ECR_REPOSITORY}/todo-app-frontend:latest
```

### 5. Deploy via GitHub Actions

Push to `main` branch or manually trigger the **CD - Deploy to AWS** workflow.

The workflow will:
1. Run Terraform init/plan/apply to create infrastructure
2. Build and push Docker images to ECR Public (via CI workflow)
3. SSH to EC2 instance and deploy containers via docker-compose

### 6. Manual Terraform Deploy (alternative)

```bash
cd terraform
terraform init
terraform plan -var="key_pair_name=your-key-pair" -var="ecr_repository_id=your-registry-id"
terraform apply -var="key_pair_name=your-key-pair" -var="ecr_repository_id=your-registry-id"
```

## Configuration

### Environment Variables (.env)

```env
DB_USER=todo_user
DB_PASSWORD=your_secure_password
DB_NAME=todo_app_aws_ec2_db
DB_PORT=5432
REACT_APP_API_URL=http://localhost:8080
```

### Terraform Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| `instance_type` | EC2 instance type | `t3.micro` | No |
| `key_pair_name` | SSH key pair name | - | **Yes** |
| `ssh_cidr` | Allowed SSH CIDR | `0.0.0.0/0` | No |
| `domain_name` | Custom domain | `""` | No |
| `certificate_arn` | ACM cert for HTTPS | `""` | No |
| `ecr_repository_id` | ECR Public registry ID | - | **Yes** |

Set via CLI: `terraform apply -var="key_pair_name=my-key" -var="ecr_repository_id=abc123"`

Or via GitHub Variables (see step 3 above).

## CI/CD Pipeline

### CI (`.github/workflows/ci.yml`)
- Lint & type-check Terraform code
- Run Go tests & build binary
- Build React production bundle
- Build & push Docker images to ECR Public

### CD (`.github/workflows/cd.yml`)
- Configure AWS credentials via OIDC
- Terraform init/plan/apply
- SSH to EC2 and deploy application via docker-compose
- Health check endpoints

### Destroy (`.github/workflows/destroy.yml`)
- Manual trigger with confirmation (type "DESTROY")
- Terraform destroy to tear down all infrastructure

## Monitoring

CloudWatch Agent collects:
- **Metrics**: CPU, memory, disk, network, swap (60s interval)
- **Logs**: Docker container logs, application logs, user-data script logs

View in CloudWatch Console:
- Log groups: `/aws/ec2/todo-app/*`
- Metrics namespace: `TodoApp/EC2`
- Dashboard: `TodoApp-EC2-Dashboard`

## Security

- DB password auto-generated in Secrets Manager (32 chars)
- EBS volume encrypted (GP3)
- Security group: SSH restricted (configurable), HTTP/HTTPS open
- IAM role: least privilege (SSM, CloudWatch, SecretsManager read, SSM Parameter read)
- GitHub Actions: OIDC federation (no static keys)
- CloudWatch logs encrypted
- Terraform state stored in S3 with DynamoDB locking (encrypted)

## Cost Estimation (us-east-1, monthly)

| Resource | Cost |
|---|---|
| EC2 t3.micro (730 hrs) | ~$7.50 (Free Tier eligible) |
| EBS 20GB GP3 | ~$1.60 |
| NAT Gateway (1 AZ) | ~$32.00 |
| Elastic IP (attached) | Free |
| CloudWatch Logs/Metrics | ~$1-5 |
| S3 State Bucket | ~$0.01 |
| DynamoDB Lock Table | ~$0.25 |
| **Total (w/ NAT)** | **~$42/month** |
| **Total (no NAT, dev)** | **~$10/month** |

*Remove NAT Gateway for dev: set `nat_gateways = 0` in vpc.tf*

## Useful Commands

```bash
# Local development
docker compose up -d
docker compose logs -f backend
docker compose down -v

# Production on EC2
ssh -i ~/.ssh/your-key.pem ec2-user@<public-ip>
cd /opt/todo-app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f

# Terraform
cd terraform
terraform init
terraform plan -var="key_pair_name=my-key" -var="ecr_repository_id=abc123"
terraform apply -var="key_pair_name=my-key" -var="ecr_repository_id=abc123"
terraform destroy -var="key_pair_name=my-key" -var="ecr_repository_id=abc123"
terraform fmt
terraform validate
terraform output

# AWS CLI
aws ec2 describe-instances --filters "Name=tag:Name,Values=TodoApp*"
aws logs tail /aws/ec2/todo-app/docker --follow
aws secretsmanager get-secret-value --secret-id <arn>
aws ssm get-parameter --name /todo-app/db/name
```

## Troubleshooting

| Issue | Solution |
|---|---|
| Terraform init fails | Verify S3 bucket and DynamoDB table exist; check AWS credentials |
| Terraform apply stuck | Check CloudFormation-style events in AWS Console (EC2/CloudWatch) |
| SSH timeout | Verify SG allows your IP on port 22; check key pair matches |
| Docker permission denied | Wait for user-data to complete (~3 min); user-data runs on boot |
| Health check fails | `docker compose logs` on instance; check ports 80/8080 |
| GitHub Actions OIDC fails | Verify role trust policy uses `job_workflow_ref` with correct repo/path |
| ECR push 403 | Verify `ecr-public:*` permissions and registry ID |
| DB_PASSWORD empty | Check Secrets Manager secret name matches filter; check IAM permissions |

## License

MIT