import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface TodoAppEc2StackProps extends cdk.StackProps {
  /** Instance type for the EC2 instance */
  instanceType?: ec2.InstanceType;
  /** Key pair name for SSH access */
  keyPairName?: string;
  /** Allowed CIDR for SSH access (default: 0.0.0.0/0) */
  sshCidr?: string;
  /** Domain name for the application (optional, for HTTPS) */
  domainName?: string;
  /** ACM certificate ARN for HTTPS (optional) */
  certificateArn?: string;
}

/** Helper to get existing key pair or undefined */
function getKeyPair(scope: Construct, keyPairName?: string): ec2.IKeyPair | undefined {
  if (!keyPairName) return undefined;
  return ec2.KeyPair.fromKeyPairName(scope, 'ExistingKeyPair', keyPairName);
}

export class TodoAppEc2Stack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly instance: ec2.Instance;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: TodoAppEc2StackProps = {}) {
    super(scope, id, props);

    const {
      instanceType = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      keyPairName,
      sshCidr = '0.0.0.0/0',
      domainName,
      certificateArn,
    } = props;

    // Resolve key pair for modern CDK API
    const keyPair = getKeyPair(this, keyPairName);

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
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(sshCidr),
      ec2.Port.tcp(22),
      'SSH access'
    );

    // HTTP
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP access'
    );

    // HTTPS (if domain configured)
    if (domainName && certificateArn) {
      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        'HTTPS access'
      );
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
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      'yum update -y',
      'yum install -y docker git amazon-cloudwatch-agent',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      '',
      '# Install Docker Compose v2',
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      '',
      '# Create app directory',
      'mkdir -p /opt/todo-app',
      'cd /opt/todo-app',
      '',
      '# Clone repository (replace with your repo)',
      'git clone https://github.com/your-username/todo-app-aws-ec2.git . || echo "Repo not found, will deploy manually"',
      '',
      '# If repo exists, deploy with docker-compose',
      'if [ -f docker-compose.prod.yml ]; then',
      '  # Pull secrets',
      `  DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${dbSecret.secretArn} --query SecretString --output text | jq -r .password)`,
      '  export DB_USER=todo_user',
      '  export DB_NAME=todo_app_aws_ec2_db',
      '  export DB_PASSWORD',
      '  export REACT_APP_API_URL=/api',
      '  docker compose -f docker-compose.prod.yml up -d',
      'fi',
      '',
      '# Setup CloudWatch Agent',
      'cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF',
      '{',
      '  "metrics": {',
      '    "namespace": "TodoApp/EC2",',
      '    "metrics_collected": {',
      '      "cpu": {"measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"], "metrics_collection_interval": 60},',
      '      "disk": {"measurement": ["used_percent"], "metrics_collection_interval": 60, "resources": ["/"]},',
      '      "diskio": {"measurement": ["io_time"], "metrics_collection_interval": 60, "resources": ["*"]},',
      '      "mem": {"measurement": ["mem_used_percent"], "metrics_collection_interval": 60},',
      '      "netstat": {"measurement": ["tcp_established"], "metrics_collection_interval": 60},',
      '      "swap": {"measurement": ["swap_used_percent"], "metrics_collection_interval": 60}',
      '    }',
      '  },',
      '  "logs": {',
      '    "logs_collected": {',
      '      "files": {',
      '        "collect_list": [',
      '          {"file_path": "/var/log/docker", "log_group_name": "/aws/ec2/todo-app/docker", "log_stream_name": "{instance_id}"},',
      '          {"file_path": "/opt/todo-app/logs/*.log", "log_group_name": "/aws/ec2/todo-app/app", "log_stream_name": "{instance_id}"}',
      '        ]',
      '      }',
      '    }',
      '  }',
      '}',
      'EOF',
      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json',
      '',
      '# Setup log rotation for docker',
      'cat > /etc/logrotate.d/docker << EOF',
      '/var/lib/docker/containers/*/*.log {',
      '  rotate 7',
      '  daily',
      '  compress',
      '  size=1M',
      '  missingok',
      '  delaycompress',
      '  copytruncate',
      '}',
      'EOF'
    );

    // ─── EC2 Instance ─────────────────────────────────────────────────────
    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: this.vpc,
      instanceType,
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: this.securityGroup,
      role: instanceRole,
      userData,
      keyPair: keyPair,
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