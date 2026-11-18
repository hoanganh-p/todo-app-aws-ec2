# Todo App Infrastructure (CDK)

Infrastructure as Code for deploying the Todo App on AWS EC2 using Docker Compose.

## Architecture

```
                    ┌─────────────────┐
                    │   GitHub Actions │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  AWS CDK Deploy  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   VPC         │   │  EC2 Instance │   │ Secrets       │
│  (2 AZs)      │──▶│  (t3.micro)   │   │ Manager       │
│  Public/Priv  │   │  Amazon Linux │   │ (DB Password) │
└───────────────┘   │  Docker/Compose│   └───────────────┘
                    │  CloudWatch   │
                    └───────────────┘
                             │
                    ┌────────▼────────┐
                    │  Elastic IP     │
                    └─────────────────┘
```

## Resources Created

| Resource | Description |
|----------|-------------|
| VPC | 2 AZs, public + private subnets, 1 NAT Gateway |
| EC2 Instance | t3.micro, Amazon Linux 2023, 20GB GP3 encrypted EBS |
| Security Group | SSH (22), HTTP (80), HTTPS (443) |
| IAM Role | SSM, CloudWatch, Secrets Manager read access |
| Secrets Manager | Auto-generated DB password |
| SSM Parameters | DB name, port, React API URL |
| Elastic IP | Static public IP for the instance |
| CloudWatch Agent | Metrics + log collection |

## Prerequisites

1. **AWS CLI configured** with credentials for account `262232992721`
2. **Node.js 20+** installed
3. **CDK bootstrapped** in the target region:
   ```bash
   cdk bootstrap aws://262232992721/us-east-1
   ```
4. **EC2 Key Pair** created in AWS Console (for SSH access)
5. **GitHub OIDC Role** created for CI/CD (see below)

## Local Development

```bash
cd infrastructure

# Install dependencies
npm ci

# Build TypeScript
npm run build

# Synthesize CloudFormation template
npx cdk synth --strict

# Show diff before deploy
npx cdk diff --strict

# Deploy
npx cdk deploy --strict
```

## Configuration

Edit `bin/todo-app-aws-ec2-infrastructure.ts` or pass context:

```bash
# Deploy with custom instance type
npx cdk deploy -c instanceType=t3.small

# Deploy with specific key pair
npx cdk deploy -c keyPairName=my-key-pair

# Deploy with restricted SSH CIDR
npx cdk deploy -c sshCidr=1.2.3.4/32

# Deploy with domain & HTTPS
npx cdk deploy -c domainName=todo.example.com -c certificateArn=arn:aws:acm:...
```

## GitHub Actions CI/CD Setup

### 1. Create OIDC IAM Role for GitHub Actions

Create role `GitHubActionsDeployRole` with trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
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
    }
  ]
}
```

Attach policies:
- `AdministratorAccess` (for CDK bootstrap/deploy) - or create custom policy with least privilege
- Or create custom policy for: CloudFormation, EC2, VPC, IAM, SecretsManager, SSM, ECR

### 2. Add GitHub Repository Secrets

| Secret | Description |
|--------|-------------|
| `EC2_SSH_PRIVATE_KEY` | Private key for the EC2 key pair (for SSH deploy) |

### 3. Add GitHub Variables

| Variable | Description |
|----------|-------------|
| `ECR_REPOSITORY` | Your ECR public repository namespace (e.g., `your-username`) |

### 4. Update docker-compose.prod.yml for ECR

Replace image references in `docker-compose.prod.yml`:
```yaml
backend:
  image: public.ecr.aws/YOUR_NAMESPACE/todo-app-backend:latest
frontend:
  image: public.ecr.aws/YOUR_NAMESPACE/todo-app-frontend:latest
```

## Useful Commands

```bash
# List stacks
npx cdk list

# Show stack outputs
npx cdk list --long

# Destroy stack (CAUTION: deletes all resources!)
npx cdk destroy

# Check drift
npx cdk drift TodoAppEc2Stack

# Run cdk-nag security checks
npx cdk synth --strict 2>&1 | npx cdk-nag

# View CloudWatch logs
aws logs tail /aws/ec2/todo-app/docker --follow
aws logs tail /aws/ec2/todo-app/app --follow
```

## Security Considerations

- DB password auto-generated and stored in Secrets Manager
- EBS volume encrypted at rest
- Security group restricts SSH (configure `sshCidr` for your IP)
- IAM role follows least privilege
- CloudWatch logs encrypted
- No hardcoded secrets in code

## Cost Optimization

- t3.micro eligible for Free Tier (750 hrs/month)
- GP3 EBS: ~$1.60/month for 20GB
- NAT Gateway: ~$32/month (consider removing for dev)
- Elastic IP: free when attached to running instance

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CDK bootstrap error | `cdk bootstrap aws://262232992721/us-east-1 --force` |
| Deploy stuck | Check CloudFormation events in console |
| SSH timeout | Verify security group allows your IP on port 22 |
| Docker permission denied | Wait for user-data to complete, or `sudo usermod -aG docker ec2-user` |
| Health check fails | Check `docker compose logs` on instance |

## File Structure

```
infrastructure/
├── bin/
│   └── todo-app-aws-ec2-infrastructure.ts   # App entry point
├── lib/
│   ├── todo-app-ec2-stack.ts                # Main stack
│   └── index.ts                             # Exports
├── Dockerfile.cdk                           # For containerized CDK
├── package.json
├── tsconfig.json
├── cdk.json
└── README.md
```