# Todo Application - AWS EC2 Deployment

A Todo REST API built with Golang and PostgreSQL, with a focus on Linux server administration, containerization, cloud deployment, and DevOps automation.

The project aims to demonstrate practical experience in developing, deploying, and operating a web application on AWS infrastructure.

## Architecture

```text
                  User / Browser
                        |
                      HTTPS
                        |
         ┌──────────────┴──────────────┐
         │      GitHub Actions CI/CD    │
         └──────────────┬──────────────┘
                        |
         ┌──────────────┴──────────────┐
         │     AWS CDK (IaC)            │
         └──────────────┬──────────────┘
                        |
         ┌──────────────┴──────────────┐
         │        AWS EC2 Instance      │
         │      Amazon Linux 2023       │
         │                              │
         │  ┌────────────────────────┐  │
         │  │     Docker Compose      │  │
         │  │  ┌──────┐ ┌──────┐     │  │
         │  │  │Front │ │Backend│     │  │
         │  │  │(Nginx)│ │(Go)  │     │  │
         │  │  └──────┘ └────┬┬┘     │  │
         │  └────────────────┼┼───────┘  │
         │                   ││          │
         │  ┌────────────────┼┼───────┐  │
         │  │  PostgreSQL   ││        │  │
         │  │  (Volume)     ││        │  │
         │  └────────────────┘│        │  │
         └────────────────────┘        │
                        │               │
         ┌──────────────┴──────────────┐
         │      AWS CloudWatch          │
         │    (Metrics + Logs)          │
         └──────────────────────────────┘
```

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
| IaC | AWS CDK (TypeScript) |
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
├── infrastructure/          # CDK IaC (TypeScript)
│   ├── bin/
│   ├── lib/
│   ├── iam-policies/
│   └── Dockerfile.cdk
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

1. **AWS Account** with CLI configured
2. **Node.js 20+** for CDK
3. **EC2 Key Pair** created in target region
4. **GitHub OIDC Role** for CI/CD (see below)

### 1. Bootstrap CDK (one-time)

```bash
cd infrastructure
npm ci
cdk bootstrap aws://262232992721/us-east-1
```

### 2. Create GitHub OIDC Role

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
        "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_USERNAME/todo-app-aws-ec2:*"
      }
    }
  }]
}
```

Attach the policy from `infrastructure/iam-policies/github-actions-deploy-policy.json`

### 3. Configure GitHub Repository

**Secrets:**
- `EC2_SSH_PRIVATE_KEY` — Private key for EC2 key pair

**Variables:**
- `ECR_REPOSITORY` — Your ECR public namespace (e.g., `your-username`)

### 4. Update docker-compose.prod.yml for ECR

```yaml
backend:
  image: public.ecr.aws/YOUR_NAMESPACE/todo-app-backend:latest
frontend:
  image: public.ecr.aws/YOUR_NAMESPACE/todo-app-frontend:latest
```

### 5. Deploy via GitHub Actions

Push to `main` branch or manually trigger the **CD - Deploy to AWS** workflow.

### 6. Manual CDK Deploy (alternative)

```bash
cd infrastructure
npm run build
cdk deploy --strict \
  -c keyPairName=your-key-pair \
  -c sshCidr=YOUR_IP/32
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

### CDK Context Options

| Option | Description | Default |
|---|---|---|
| `instanceType` | EC2 instance type | `t3.micro` |
| `keyPairName` | SSH key pair name | (required) |
| `sshCidr` | Allowed SSH CIDR | `0.0.0.0/0` |
| `domainName` | Custom domain | (optional) |
| `certificateArn` | ACM cert for HTTPS | (optional) |

## CI/CD Pipeline

### CI (`.github/workflows/ci.yml`)
- Lint & type-check CDK code
- Run Go tests & build binary
- Build React production bundle
- Build & push Docker images to ECR Public

### CD (`.github/workflows/cd.yml`)
- Deploy CDK infrastructure
- Pull latest images on EC2 via SSH
- Run docker-compose with secrets from Secrets Manager
- Health check endpoints

### Destroy (`.github/workflows/destroy.yml`)
- Manual trigger with confirmation
- Destroys CDK stack
- Optionally cleans ECR repos

## Monitoring

CloudWatch Agent collects:
- **Metrics**: CPU, memory, disk, network, swap (60s interval)
- **Logs**: Docker container logs, application logs

View in CloudWatch Console:
- Log groups: `/aws/ec2/todo-app/docker`, `/aws/ec2/todo-app/app`
- Metrics namespace: `TodoApp/EC2`

## Security

- DB password auto-generated in Secrets Manager (32 chars)
- EBS volume encrypted (GP3)
- Security group: SSH restricted (configurable), HTTP/HTTPS open
- IAM role: least privilege (SSM, CloudWatch, SecretsManager read)
- GitHub Actions: OIDC federation (no static keys)
- CloudWatch logs encrypted

## Cost Estimation (us-east-1, monthly)

| Resource | Cost |
|---|---|
| EC2 t3.micro (730 hrs) | ~$7.50 (Free Tier eligible) |
| EBS 20GB GP3 | ~$1.60 |
| NAT Gateway (1 AZ) | ~$32.00 |
| Elastic IP (attached) | Free |
| CloudWatch Logs/Metrics | ~$1-5 |
| **Total (w/ NAT)** | **~$42/month** |
| **Total (no NAT, dev)** | **~$10/month** |

*Remove NAT Gateway for dev: set `natGateways: 0` in VPC config*

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

# CDK
cd infrastructure
npx cdk diff
npx cdk deploy
npx cdk destroy
npx cdk drift TodoAppEc2Stack

# AWS CLI
aws ec2 describe-instances --filters "Name=tag:Name,Values=TodoApp*"
aws logs tail /aws/ec2/todo-app/docker --follow
aws secretsmanager get-secret-value --secret-id <arn>
```

## Troubleshooting

| Issue | Solution |
|---|---|
| CDK bootstrap fails | `cdk bootstrap aws://262232992721/us-east-1 --force` |
| Deploy stuck | Check CloudFormation events in AWS Console |
| SSH timeout | Verify SG allows your IP on port 22; check key pair |
| Docker permission denied | Wait for user-data to complete (~3 min) |
| Health check fails | `docker compose logs` on instance; check ports 80/8080 |
| GitHub Actions OIDC fails | Verify role trust policy matches repo/org |

## License

MIT