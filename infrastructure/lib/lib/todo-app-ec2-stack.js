"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TodoAppEc2Stack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
class TodoAppEc2Stack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        super(scope, id, props);
        const { instanceType = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO), keyPairName, sshCidr = '0.0.0.0/0', domainName, certificateArn, } = props;
        // ─── VPC ───────────────────────────────────────────────────────────────
        this.vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
            ],
            enableDnsHostnames: true,
            enableDnsSupport: true,
        });
        // ─── Security Group ───────────────────────────────────────────────────
        this.securityGroup = new ec2.SecurityGroup(this, 'InstanceSG', {
            vpc: this.vpc,
            description: 'Security group for Todo App EC2 instance',
            allowAllOutbound: true,
        });
        // SSH access
        this.securityGroup.addIngressRule(ec2.Peer.ipv4(sshCidr), ec2.Port.tcp(22), 'SSH access');
        // HTTP
        this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP access');
        // HTTPS (if domain configured)
        if (domainName && certificateArn) {
            this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS access');
        }
        // ─── IAM Role for EC2 ─────────────────────────────────────────────────
        const instanceRole = new iam.Role(this, 'InstanceRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
            ],
        });
        // Permissions to read secrets from Secrets Manager
        instanceRole.addToPolicy(new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'secretsmanager:ResourceTag/aws:cloudformation:stack-name': this.stackName,
                },
            },
        }));
        // Permissions to read parameters from SSM Parameter Store
        instanceRole.addToPolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/todo-app/*`,
            ],
        }));
        // ─── Secrets Manager for DB credentials ───────────────────────────────
        const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
            description: 'PostgreSQL credentials for Todo App',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'todo_user' }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\',
                passwordLength: 32,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // ─── SSM Parameters for app config ────────────────────────────────────
        new ssm.StringParameter(this, 'DbNameParam', {
            parameterName: '/todo-app/db-name',
            stringValue: 'todo_app_aws_ec2_db',
            description: 'PostgreSQL database name',
        });
        new ssm.StringParameter(this, 'DbPortParam', {
            parameterName: '/todo-app/db-port',
            stringValue: '5432',
            description: 'PostgreSQL port',
        });
        new ssm.StringParameter(this, 'ReactApiUrlParam', {
            parameterName: '/todo-app/react-api-url',
            stringValue: domainName ? `https://${domainName}/api` : '/api',
            description: 'React app API URL',
        });
        // ─── User Data Script ─────────────────────────────────────────────────
        const userData = ec2.UserData.forLinux();
        userData.addCommands('#!/bin/bash', 'set -e', 'yum update -y', 'yum install -y docker git amazon-cloudwatch-agent', 'systemctl start docker', 'systemctl enable docker', 'usermod -a -G docker ec2-user', '', '# Install Docker Compose v2', 'mkdir -p /usr/local/lib/docker/cli-plugins', 'curl -SL https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose', 'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose', '', '# Create app directory', 'mkdir -p /opt/todo-app', 'cd /opt/todo-app', '', '# Clone repository (replace with your repo)', 'git clone https://github.com/your-username/todo-app-aws-ec2.git . || echo "Repo not found, will deploy manually"', '', '# If repo exists, deploy with docker-compose', 'if [ -f docker-compose.prod.yml ]; then', '  # Pull secrets', `  DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${dbSecret.secretArn} --query SecretString --output text | jq -r .password)`, '  export DB_USER=todo_user', '  export DB_NAME=todo_app_aws_ec2_db', '  export DB_PASSWORD', '  export REACT_APP_API_URL=/api', '  docker compose -f docker-compose.prod.yml up -d', 'fi', '', '# Setup CloudWatch Agent', 'cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF', '{', '  "metrics": {', '    "namespace": "TodoApp/EC2",', '    "metrics_collected": {', '      "cpu": {"measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"], "metrics_collection_interval": 60},', '      "disk": {"measurement": ["used_percent"], "metrics_collection_interval": 60, "resources": ["/"]},', '      "diskio": {"measurement": ["io_time"], "metrics_collection_interval": 60, "resources": ["*"]},', '      "mem": {"measurement": ["mem_used_percent"], "metrics_collection_interval": 60},', '      "netstat": {"measurement": ["tcp_established"], "metrics_collection_interval": 60},', '      "swap": {"measurement": ["swap_used_percent"], "metrics_collection_interval": 60}', '    }', '  },', '  "logs": {', '    "logs_collected": {', '      "files": {', '        "collect_list": [', '          {"file_path": "/var/log/docker", "log_group_name": "/aws/ec2/todo-app/docker", "log_stream_name": "{instance_id}"},', '          {"file_path": "/opt/todo-app/logs/*.log", "log_group_name": "/aws/ec2/todo-app/app", "log_stream_name": "{instance_id}"}', '        ]', '      }', '    }', '  }', '}', 'EOF', '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json', '', '# Setup log rotation for docker', 'cat > /etc/logrotate.d/docker << EOF', '/var/lib/docker/containers/*/*.log {', '  rotate 7', '  daily', '  compress', '  size=1M', '  missingok', '  delaycompress', '  copytruncate', '}', 'EOF');
        // ─── EC2 Instance ─────────────────────────────────────────────────────
        this.instance = new ec2.Instance(this, 'Instance', {
            vpc: this.vpc,
            instanceType,
            machineImage: ec2.MachineImage.latestAmazonLinux2023(),
            securityGroup: this.securityGroup,
            role: instanceRole,
            userData,
            keyName: keyPairName,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
            blockDevices: [
                {
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(20, {
                        volumeType: ec2.EbsDeviceVolumeType.GP3,
                        encrypted: true,
                        deleteOnTermination: true,
                    }),
                },
            ],
        });
        // ─── Elastic IP (optional, for stable public IP) ──────────────────────
        const eip = new ec2.CfnEIP(this, 'InstanceEIP', {
            domain: 'vpc',
            instanceId: this.instance.instanceId,
            tags: [{ key: 'Name', value: 'TodoApp-EIP' }],
        });
        // ─── Outputs ──────────────────────────────────────────────────────────
        new cdk.CfnOutput(this, 'InstanceId', {
            value: this.instance.instanceId,
            description: 'EC2 Instance ID',
        });
        new cdk.CfnOutput(this, 'InstancePublicIp', {
            value: this.instance.instancePublicIp,
            description: 'EC2 Instance Public IP',
        });
        new cdk.CfnOutput(this, 'InstancePublicDns', {
            value: this.instance.instancePublicDnsName,
            description: 'EC2 Instance Public DNS',
        });
        new cdk.CfnOutput(this, 'ElasticIp', {
            value: eip.ref,
            description: 'Elastic IP for the instance',
        });
        new cdk.CfnOutput(this, 'SshCommand', {
            value: `ssh -i ~/.ssh/${keyPairName || 'your-key'}.pem ec2-user@${this.instance.instancePublicDnsName}`,
            description: 'SSH command to connect to the instance',
        });
        new cdk.CfnOutput(this, 'DbSecretArn', {
            value: dbSecret.secretArn,
            description: 'Database secret ARN in Secrets Manager',
        });
        new cdk.CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            description: 'VPC ID',
        });
        // ─── Tags ─────────────────────────────────────────────────────────────
        cdk.Tags.of(this).add('Project', 'TodoApp');
        cdk.Tags.of(this).add('Environment', 'production');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
    }
}
exports.TodoAppEc2Stack = TodoAppEc2Stack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9kby1hcHAtZWMyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vdG9kby1hcHAtZWMyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLCtFQUFpRTtBQWdCakUsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSzVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsUUFBOEIsRUFBRTtRQUN4RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQ0osWUFBWSxHQUFHLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLEVBQ2hGLFdBQVcsRUFDWCxPQUFPLEdBQUcsV0FBVyxFQUNyQixVQUFVLEVBQ1YsY0FBYyxHQUNmLEdBQUcsS0FBSyxDQUFDO1FBRVYsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbEMsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO29CQUNqQyxRQUFRLEVBQUUsRUFBRTtpQkFDYjtnQkFDRDtvQkFDRSxJQUFJLEVBQUUsU0FBUztvQkFDZixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7b0JBQzlDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2FBQ0Y7WUFDRCxrQkFBa0IsRUFBRSxJQUFJO1lBQ3hC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QyxLQUFLLEVBQUUsaUJBQWlCLFdBQVcsSUFBSSxVQUFVLGlCQUFpQixJQUFJLENBQUMsUUFBUSxDQUFDLHFCQUFxQixFQUFFO1lBQ3ZHLFdBQVcsRUFBRSx3Q0FBd0M7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxTQUFTO1lBQ3pCLFdBQVcsRUFBRSx3Q0FBd0M7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDL0IsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSztZQUNyQixXQUFXLEVBQUUsUUFBUTtTQUN0QixDQUFDLENBQUM7UUFFSCx5RUFBeUU7UUFDekUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUM1QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ25ELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDNUMsQ0FBQztDQUNGO0FBalJELDBDQWlSQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVG9kb0FwcEVjMlN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBJbnN0YW5jZSB0eXBlIGZvciB0aGUgRUMyIGluc3RhbmNlICovXG4gIGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG4gIC8qKiBLZXkgcGFpciBuYW1lIGZvciBTU0ggYWNjZXNzICovXG4gIGtleVBhaXJOYW1lPzogc3RyaW5nO1xuICAvKiogQWxsb3dlZCBDSURSIGZvciBTU0ggYWNjZXNzIChkZWZhdWx0OiAwLjAuMC4wLzApICovXG4gIHNzaENpZHI/OiBzdHJpbmc7XG4gIC8qKiBEb21haW4gbmFtZSBmb3IgdGhlIGFwcGxpY2F0aW9uIChvcHRpb25hbCwgZm9yIEhUVFBTKSAqL1xuICBkb21haW5OYW1lPzogc3RyaW5nO1xuICAvKiogQUNNIGNlcnRpZmljYXRlIEFSTiBmb3IgSFRUUFMgKG9wdGlvbmFsKSAqL1xuICBjZXJ0aWZpY2F0ZUFybj86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFRvZG9BcHBFYzJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB2cGM6IGVjMi5WcGM7XG4gIHB1YmxpYyByZWFkb25seSBpbnN0YW5jZTogZWMyLkluc3RhbmNlO1xuICBwdWJsaWMgcmVhZG9ubHkgc2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFRvZG9BcHBFYzJTdGFja1Byb3BzID0ge30pIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIGluc3RhbmNlVHlwZSA9IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuVDMsIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8pLFxuICAgICAga2V5UGFpck5hbWUsXG4gICAgICBzc2hDaWRyID0gJzAuMC4wLjAvMCcsXG4gICAgICBkb21haW5OYW1lLFxuICAgICAgY2VydGlmaWNhdGVBcm4sXG4gICAgfSA9IHByb3BzO1xuXG4gICAgLy8g4pSA4pSA4pSAIFZQQyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICB0aGlzLnZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAncHJpdmF0ZScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZW5hYmxlRG5zSG9zdG5hbWVzOiB0cnVlLFxuICAgICAgZW5hYmxlRG5zU3VwcG9ydDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgCBTZWN1cml0eSBHcm91cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0luc3RhbmNlU0cnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgVG9kbyBBcHAgRUMyIGluc3RhbmNlJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBTU0ggYWNjZXNzXG4gICAgdGhpcy5zZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuaXB2NChzc2hDaWRyKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCgyMiksXG4gICAgICAnU1NIIGFjY2VzcydcbiAgICApO1xuXG4gICAgLy8gSFRUUFxuICAgIHRoaXMuc2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmFueUlwdjQoKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg4MCksXG4gICAgICAnSFRUUCBhY2Nlc3MnXG4gICAgKTtcblxuICAgIC8vIEhUVFBTIChpZiBkb21haW4gY29uZmlndXJlZClcbiAgICBpZiAoZG9tYWluTmFtZSAmJiBjZXJ0aWZpY2F0ZUFybikge1xuICAgICAgdGhpcy5zZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICBlYzIuUGVlci5hbnlJcHY0KCksXG4gICAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgICAnSFRUUFMgYWNjZXNzJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyDilIDilIDilIAgSUFNIFJvbGUgZm9yIEVDMiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBpbnN0YW5jZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0luc3RhbmNlUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlYzIuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hBZ2VudFNlcnZlclBvbGljeScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIFBlcm1pc3Npb25zIHRvIHJlYWQgc2VjcmV0cyBmcm9tIFNlY3JldHMgTWFuYWdlclxuICAgIGluc3RhbmNlUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAnc2VjcmV0c21hbmFnZXI6UmVzb3VyY2VUYWcvYXdzOmNsb3VkZm9ybWF0aW9uOnN0YWNrLW5hbWUnOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgLy8gUGVybWlzc2lvbnMgdG8gcmVhZCBwYXJhbWV0ZXJzIGZyb20gU1NNIFBhcmFtZXRlciBTdG9yZVxuICAgIGluc3RhbmNlUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3NzbTpHZXRQYXJhbWV0ZXInLCAnc3NtOkdldFBhcmFtZXRlcnMnXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlci90b2RvLWFwcC8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8g4pSA4pSA4pSAIFNlY3JldHMgTWFuYWdlciBmb3IgREIgY3JlZGVudGlhbHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgZGJTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdEYlNlY3JldCcsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnUG9zdGdyZVNRTCBjcmVkZW50aWFscyBmb3IgVG9kbyBBcHAnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHsgdXNlcm5hbWU6ICd0b2RvX3VzZXInIH0pLFxuICAgICAgICBnZW5lcmF0ZVN0cmluZ0tleTogJ3Bhc3N3b3JkJyxcbiAgICAgICAgZXhjbHVkZUNoYXJhY3RlcnM6ICdcIkAvXFxcXCcsXG4gICAgICAgIHBhc3N3b3JkTGVuZ3RoOiAzMixcbiAgICAgIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSAIFNTTSBQYXJhbWV0ZXJzIGZvciBhcHAgY29uZmlnIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdEYk5hbWVQYXJhbScsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6ICcvdG9kby1hcHAvZGItbmFtZScsXG4gICAgICBzdHJpbmdWYWx1ZTogJ3RvZG9fYXBwX2F3c19lYzJfZGInLFxuICAgICAgZGVzY3JpcHRpb246ICdQb3N0Z3JlU1FMIGRhdGFiYXNlIG5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0RiUG9ydFBhcmFtJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogJy90b2RvLWFwcC9kYi1wb3J0JyxcbiAgICAgIHN0cmluZ1ZhbHVlOiAnNTQzMicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1Bvc3RncmVTUUwgcG9ydCcsXG4gICAgfSk7XG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnUmVhY3RBcGlVcmxQYXJhbScsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6ICcvdG9kby1hcHAvcmVhY3QtYXBpLXVybCcsXG4gICAgICBzdHJpbmdWYWx1ZTogZG9tYWluTmFtZSA/IGBodHRwczovLyR7ZG9tYWluTmFtZX0vYXBpYCA6ICcvYXBpJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmVhY3QgYXBwIEFQSSBVUkwnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSAIFVzZXIgRGF0YSBTY3JpcHQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgdXNlckRhdGEgPSBlYzIuVXNlckRhdGEuZm9yTGludXgoKTtcbiAgICB1c2VyRGF0YS5hZGRDb21tYW5kcyhcbiAgICAgICcjIS9iaW4vYmFzaCcsXG4gICAgICAnc2V0IC1lJyxcbiAgICAgICd5dW0gdXBkYXRlIC15JyxcbiAgICAgICd5dW0gaW5zdGFsbCAteSBkb2NrZXIgZ2l0IGFtYXpvbi1jbG91ZHdhdGNoLWFnZW50JyxcbiAgICAgICdzeXN0ZW1jdGwgc3RhcnQgZG9ja2VyJyxcbiAgICAgICdzeXN0ZW1jdGwgZW5hYmxlIGRvY2tlcicsXG4gICAgICAndXNlcm1vZCAtYSAtRyBkb2NrZXIgZWMyLXVzZXInLFxuICAgICAgJycsXG4gICAgICAnIyBJbnN0YWxsIERvY2tlciBDb21wb3NlIHYyJyxcbiAgICAgICdta2RpciAtcCAvdXNyL2xvY2FsL2xpYi9kb2NrZXIvY2xpLXBsdWdpbnMnLFxuICAgICAgJ2N1cmwgLVNMIGh0dHBzOi8vZ2l0aHViLmNvbS9kb2NrZXIvY29tcG9zZS9yZWxlYXNlcy9kb3dubG9hZC92Mi4yNC41L2RvY2tlci1jb21wb3NlLWxpbnV4LXg4Nl82NCAtbyAvdXNyL2xvY2FsL2xpYi9kb2NrZXIvY2xpLXBsdWdpbnMvZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgJ2NobW9kICt4IC91c3IvbG9jYWwvbGliL2RvY2tlci9jbGktcGx1Z2lucy9kb2NrZXItY29tcG9zZScsXG4gICAgICAnJyxcbiAgICAgICcjIENyZWF0ZSBhcHAgZGlyZWN0b3J5JyxcbiAgICAgICdta2RpciAtcCAvb3B0L3RvZG8tYXBwJyxcbiAgICAgICdjZCAvb3B0L3RvZG8tYXBwJyxcbiAgICAgICcnLFxuICAgICAgJyMgQ2xvbmUgcmVwb3NpdG9yeSAocmVwbGFjZSB3aXRoIHlvdXIgcmVwbyknLFxuICAgICAgJ2dpdCBjbG9uZSBodHRwczovL2dpdGh1Yi5jb20veW91ci11c2VybmFtZS90b2RvLWFwcC1hd3MtZWMyLmdpdCAuIHx8IGVjaG8gXCJSZXBvIG5vdCBmb3VuZCwgd2lsbCBkZXBsb3kgbWFudWFsbHlcIicsXG4gICAgICAnJyxcbiAgICAgICcjIElmIHJlcG8gZXhpc3RzLCBkZXBsb3kgd2l0aCBkb2NrZXItY29tcG9zZScsXG4gICAgICAnaWYgWyAtZiBkb2NrZXItY29tcG9zZS5wcm9kLnltbCBdOyB0aGVuJyxcbiAgICAgICcgICMgUHVsbCBzZWNyZXRzJyxcbiAgICAgIGAgIERCX1BBU1NXT1JEPSQoYXdzIHNlY3JldHNtYW5hZ2VyIGdldC1zZWNyZXQtdmFsdWUgLS1zZWNyZXQtaWQgJHtkYlNlY3JldC5zZWNyZXRBcm59IC0tcXVlcnkgU2VjcmV0U3RyaW5nIC0tb3V0cHV0IHRleHQgfCBqcSAtciAucGFzc3dvcmQpYCxcbiAgICAgICcgIGV4cG9ydCBEQl9VU0VSPXRvZG9fdXNlcicsXG4gICAgICAnICBleHBvcnQgREJfTkFNRT10b2RvX2FwcF9hd3NfZWMyX2RiJyxcbiAgICAgICcgIGV4cG9ydCBEQl9QQVNTV09SRCcsXG4gICAgICAnICBleHBvcnQgUkVBQ1RfQVBQX0FQSV9VUkw9L2FwaScsXG4gICAgICAnICBkb2NrZXIgY29tcG9zZSAtZiBkb2NrZXItY29tcG9zZS5wcm9kLnltbCB1cCAtZCcsXG4gICAgICAnZmknLFxuICAgICAgJycsXG4gICAgICAnIyBTZXR1cCBDbG91ZFdhdGNoIEFnZW50JyxcbiAgICAgICdjYXQgPiAvb3B0L2F3cy9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC9ldGMvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQuanNvbiA8PCBFT0YnLFxuICAgICAgJ3snLFxuICAgICAgJyAgXCJtZXRyaWNzXCI6IHsnLFxuICAgICAgJyAgICBcIm5hbWVzcGFjZVwiOiBcIlRvZG9BcHAvRUMyXCIsJyxcbiAgICAgICcgICAgXCJtZXRyaWNzX2NvbGxlY3RlZFwiOiB7JyxcbiAgICAgICcgICAgICBcImNwdVwiOiB7XCJtZWFzdXJlbWVudFwiOiBbXCJjcHVfdXNhZ2VfaWRsZVwiLCBcImNwdV91c2FnZV91c2VyXCIsIFwiY3B1X3VzYWdlX3N5c3RlbVwiXSwgXCJtZXRyaWNzX2NvbGxlY3Rpb25faW50ZXJ2YWxcIjogNjB9LCcsXG4gICAgICAnICAgICAgXCJkaXNrXCI6IHtcIm1lYXN1cmVtZW50XCI6IFtcInVzZWRfcGVyY2VudFwiXSwgXCJtZXRyaWNzX2NvbGxlY3Rpb25faW50ZXJ2YWxcIjogNjAsIFwicmVzb3VyY2VzXCI6IFtcIi9cIl19LCcsXG4gICAgICAnICAgICAgXCJkaXNraW9cIjoge1wibWVhc3VyZW1lbnRcIjogW1wiaW9fdGltZVwiXSwgXCJtZXRyaWNzX2NvbGxlY3Rpb25faW50ZXJ2YWxcIjogNjAsIFwicmVzb3VyY2VzXCI6IFtcIipcIl19LCcsXG4gICAgICAnICAgICAgXCJtZW1cIjoge1wibWVhc3VyZW1lbnRcIjogW1wibWVtX3VzZWRfcGVyY2VudFwiXSwgXCJtZXRyaWNzX2NvbGxlY3Rpb25faW50ZXJ2YWxcIjogNjB9LCcsXG4gICAgICAnICAgICAgXCJuZXRzdGF0XCI6IHtcIm1lYXN1cmVtZW50XCI6IFtcInRjcF9lc3RhYmxpc2hlZFwiXSwgXCJtZXRyaWNzX2NvbGxlY3Rpb25faW50ZXJ2YWxcIjogNjB9LCcsXG4gICAgICAnICAgICAgXCJzd2FwXCI6IHtcIm1lYXN1cmVtZW50XCI6IFtcInN3YXBfdXNlZF9wZXJjZW50XCJdLCBcIm1ldHJpY3NfY29sbGVjdGlvbl9pbnRlcnZhbFwiOiA2MH0nLFxuICAgICAgJyAgICB9JyxcbiAgICAgICcgIH0sJyxcbiAgICAgICcgIFwibG9nc1wiOiB7JyxcbiAgICAgICcgICAgXCJsb2dzX2NvbGxlY3RlZFwiOiB7JyxcbiAgICAgICcgICAgICBcImZpbGVzXCI6IHsnLFxuICAgICAgJyAgICAgICAgXCJjb2xsZWN0X2xpc3RcIjogWycsXG4gICAgICAnICAgICAgICAgIHtcImZpbGVfcGF0aFwiOiBcIi92YXIvbG9nL2RvY2tlclwiLCBcImxvZ19ncm91cF9uYW1lXCI6IFwiL2F3cy9lYzIvdG9kby1hcHAvZG9ja2VyXCIsIFwibG9nX3N0cmVhbV9uYW1lXCI6IFwie2luc3RhbmNlX2lkfVwifSwnLFxuICAgICAgJyAgICAgICAgICB7XCJmaWxlX3BhdGhcIjogXCIvb3B0L3RvZG8tYXBwL2xvZ3MvKi5sb2dcIiwgXCJsb2dfZ3JvdXBfbmFtZVwiOiBcIi9hd3MvZWMyL3RvZG8tYXBwL2FwcFwiLCBcImxvZ19zdHJlYW1fbmFtZVwiOiBcIntpbnN0YW5jZV9pZH1cIn0nLFxuICAgICAgJyAgICAgICAgXScsXG4gICAgICAnICAgICAgfScsXG4gICAgICAnICAgIH0nLFxuICAgICAgJyAgfScsXG4gICAgICAnfScsXG4gICAgICAnRU9GJyxcbiAgICAgICcvb3B0L2F3cy9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC9iaW4vYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQtY3RsIC1hIGZldGNoLWNvbmZpZyAtbSBlYzIgLXMgLWMgZmlsZTovb3B0L2F3cy9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC9ldGMvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQuanNvbicsXG4gICAgICAnJyxcbiAgICAgICcjIFNldHVwIGxvZyByb3RhdGlvbiBmb3IgZG9ja2VyJyxcbiAgICAgICdjYXQgPiAvZXRjL2xvZ3JvdGF0ZS5kL2RvY2tlciA8PCBFT0YnLFxuICAgICAgJy92YXIvbGliL2RvY2tlci9jb250YWluZXJzLyovKi5sb2cgeycsXG4gICAgICAnICByb3RhdGUgNycsXG4gICAgICAnICBkYWlseScsXG4gICAgICAnICBjb21wcmVzcycsXG4gICAgICAnICBzaXplPTFNJyxcbiAgICAgICcgIG1pc3NpbmdvaycsXG4gICAgICAnICBkZWxheWNvbXByZXNzJyxcbiAgICAgICcgIGNvcHl0cnVuY2F0ZScsXG4gICAgICAnfScsXG4gICAgICAnRU9GJ1xuICAgICk7XG5cbiAgICAvLyDilIDilIDilIAgRUMyIEluc3RhbmNlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIHRoaXMuaW5zdGFuY2UgPSBuZXcgZWMyLkluc3RhbmNlKHRoaXMsICdJbnN0YW5jZScsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBpbnN0YW5jZVR5cGUsXG4gICAgICBtYWNoaW5lSW1hZ2U6IGVjMi5NYWNoaW5lSW1hZ2UubGF0ZXN0QW1hem9uTGludXgyMDIzKCksXG4gICAgICBzZWN1cml0eUdyb3VwOiB0aGlzLnNlY3VyaXR5R3JvdXAsXG4gICAgICByb2xlOiBpbnN0YW5jZVJvbGUsXG4gICAgICB1c2VyRGF0YSxcbiAgICAgIGtleU5hbWU6IGtleVBhaXJOYW1lLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICB9LFxuICAgICAgYmxvY2tEZXZpY2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXZpY2VOYW1lOiAnL2Rldi94dmRhJyxcbiAgICAgICAgICB2b2x1bWU6IGVjMi5CbG9ja0RldmljZVZvbHVtZS5lYnMoMjAsIHtcbiAgICAgICAgICAgIHZvbHVtZVR5cGU6IGVjMi5FYnNEZXZpY2VWb2x1bWVUeXBlLkdQMyxcbiAgICAgICAgICAgIGVuY3J5cHRlZDogdHJ1ZSxcbiAgICAgICAgICAgIGRlbGV0ZU9uVGVybWluYXRpb246IHRydWUsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSAIEVsYXN0aWMgSVAgKG9wdGlvbmFsLCBmb3Igc3RhYmxlIHB1YmxpYyBJUCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgZWlwID0gbmV3IGVjMi5DZm5FSVAodGhpcywgJ0luc3RhbmNlRUlQJywge1xuICAgICAgZG9tYWluOiAndnBjJyxcbiAgICAgIGluc3RhbmNlSWQ6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgIHRhZ3M6IFt7IGtleTogJ05hbWUnLCB2YWx1ZTogJ1RvZG9BcHAtRUlQJyB9XSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgCBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbnN0YW5jZUlkJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUMyIEluc3RhbmNlIElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbnN0YW5jZVB1YmxpY0lwJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VQdWJsaWNJcCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUMyIEluc3RhbmNlIFB1YmxpYyBJUCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW5zdGFuY2VQdWJsaWNEbnMnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5pbnN0YW5jZS5pbnN0YW5jZVB1YmxpY0Ruc05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDMiBJbnN0YW5jZSBQdWJsaWMgRE5TJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFbGFzdGljSXAnLCB7XG4gICAgICB2YWx1ZTogZWlwLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpYyBJUCBmb3IgdGhlIGluc3RhbmNlJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTc2hDb21tYW5kJywge1xuICAgICAgdmFsdWU6IGBzc2ggLWkgfi8uc3NoLyR7a2V5UGFpck5hbWUgfHwgJ3lvdXIta2V5J30ucGVtIGVjMi11c2VyQCR7dGhpcy5pbnN0YW5jZS5pbnN0YW5jZVB1YmxpY0Ruc05hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU1NIIGNvbW1hbmQgdG8gY29ubmVjdCB0byB0aGUgaW5zdGFuY2UnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RiU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IGRiU2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGF0YWJhc2Ugc2VjcmV0IEFSTiBpbiBTZWNyZXRzIE1hbmFnZXInLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgSUQnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSAIFRhZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdQcm9qZWN0JywgJ1RvZG9BcHAnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Vudmlyb25tZW50JywgJ3Byb2R1Y3Rpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiAgfVxufSJdfQ==