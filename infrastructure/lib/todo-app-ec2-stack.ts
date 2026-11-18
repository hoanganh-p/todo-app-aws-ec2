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

export class TodoAppEc2Stack extends cdk.Stack {
  public readonly vpcId: string;
  public readonly instanceId: string;
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

    // ─── VPC (L1 constructs - no AWS calls at synth) ─────────────────────────
    const vpc = new ec2.CfnVPC(this, 'Vpc', {
      cidrBlock: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: [
        { key: 'Name', value: 'TodoAppEc2Stack/Vpc' },
        { key: 'Project', value: 'TodoApp' },
        { key: 'Environment', value: 'production' },
        { key: 'ManagedBy', value: 'CDK' },
      ],
    });
    this.vpcId = vpc.ref;

    // Internet Gateway
    const igw = new ec2.CfnInternetGateway(this, 'IGW', {
      tags: [{ key: 'Name', value: 'TodoAppEc2Stack/Vpc' }],
    });
    new ec2.CfnVPCGatewayAttachment(this, 'IGWAttach', {
      vpcId: vpc.ref,
      internetGatewayId: igw.ref,
    });

    // Public Subnets (2 AZs)
    const publicSubnet1 = new ec2.CfnSubnet(this, 'PublicSubnet1', {
      vpcId: vpc.ref,
      cidrBlock: '10.0.0.0/24',
      availabilityZone: 'us-east-1a',
      mapPublicIpOnLaunch: true,
      tags: [
        { key: 'aws-cdk:subnet-name', value: 'public' },
        { key: 'aws-cdk:subnet-type', value: 'Public' },
        { key: 'Name', value: 'TodoAppEc2Stack/Vpc/publicSubnet1' },
      ],
    });
    const publicSubnet2 = new ec2.CfnSubnet(this, 'PublicSubnet2', {
      vpcId: vpc.ref,
      cidrBlock: '10.0.1.0/24',
      availabilityZone: 'us-east-1b',
      mapPublicIpOnLaunch: true,
      tags: [
        { key: 'aws-cdk:subnet-name', value: 'public' },
        { key: 'aws-cdk:subnet-type', value: 'Public' },
        { key: 'Name', value: 'TodoAppEc2Stack/Vpc/publicSubnet2' },
      ],
    });

    // Private Subnets (2 AZs)
    const privateSubnet1 = new ec2.CfnSubnet(this, 'PrivateSubnet1', {
      vpcId: vpc.ref,
      cidrBlock: '10.0.2.0/24',
      availabilityZone: 'us-east-1a',
      mapPublicIpOnLaunch: false,
      tags: [
        { key: 'aws-cdk:subnet-name', value: 'private' },
        { key: 'aws-cdk:subnet-type', value: 'Private' },
        { key: 'Name', value: 'TodoAppEc2Stack/Vpc/privateSubnet1' },
      ],
    });
    const privateSubnet2 = new ec2.CfnSubnet(this, 'PrivateSubnet2', {
      vpcId: vpc.ref,
      cidrBlock: '10.0.3.0/24',
      availabilityZone: 'us-east-1b',
      mapPublicIpOnLaunch: false,
      tags: [
        { key: 'aws-cdk:subnet-name', value: 'private' },
        { key: 'aws-cdk:subnet-type', value: 'Private' },
        { key: 'Name', value: 'TodoAppEc2Stack/Vpc/privateSubnet2' },
      ],
    });

    // NAT Gateway (in public subnet 1)
    const natEip = new ec2.CfnEIP(this, 'NatEIP', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: 'TodoAppEc2Stack/Vpc/publicSubnet1' }],
    });
    const natGateway = new ec2.CfnNatGateway(this, 'NatGateway', {
      allocationId: natEip.attrAllocationId,
      subnetId: publicSubnet1.ref,
      tags: [{ key: 'Name', value: 'TodoAppEc2Stack/Vpc/publicSubnet1' }],
    });

    // Public Route Table
    const publicRouteTable = new ec2.CfnRouteTable(this, 'PublicRouteTable', {
      vpcId: vpc.ref,
      tags: [{ key: 'Name', value: 'TodoAppEc2Stack/Vpc/publicSubnet1' }],
    });
    new ec2.CfnRoute(this, 'PublicDefaultRoute', {
      routeTableId: publicRouteTable.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: igw.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PublicSubnet1RTAssoc', {
      routeTableId: publicRouteTable.ref,
      subnetId: publicSubnet1.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PublicSubnet2RTAssoc', {
      routeTableId: publicRouteTable.ref,
      subnetId: publicSubnet2.ref,
    });

    // Private Route Table (via NAT)
    const privateRouteTable = new ec2.CfnRouteTable(this, 'PrivateRouteTable', {
      vpcId: vpc.ref,
      tags: [{ key: 'Name', value: 'TodoAppEc2Stack/Vpc/privateSubnet1' }],
    });
    new ec2.CfnRoute(this, 'PrivateDefaultRoute', {
      routeTableId: privateRouteTable.ref,
      destinationCidrBlock: '0.0.0.0/0',
      natGatewayId: natGateway.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivateSubnet1RTAssoc', {
      routeTableId: privateRouteTable.ref,
      subnetId: privateSubnet1.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivateSubnet2RTAssoc', {
      routeTableId: privateRouteTable.ref,
      subnetId: privateSubnet2.ref,
    });

    // ─── Security Group ───────────────────────────────────────────────────────
    this.securityGroup = new ec2.SecurityGroup(this, 'InstanceSG', {
      vpc: ec2.Vpc.fromVpcAttributes(this, 'VpcRef', {
        vpcId: vpc.ref,
        availabilityZones: ['us-east-1a', 'us-east-1b'],
        publicSubnetIds: [publicSubnet1.ref, publicSubnet2.ref],
        privateSubnetIds: [privateSubnet1.ref, privateSubnet2.ref],
      }),
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

    // ─── IAM Role for EC2 ─────────────────────────────────────────────────────
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
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/todo-app/*`,
      ],
    }));

    // ─── Secrets Manager for DB credentials ───────────────────────────────────
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

    // ─── SSM Parameters for app config ────────────────────────────────────────
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

    // ─── User Data Script ─────────────────────────────────────────────────────
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

    // ─── EC2 Instance (L1 - no IVpc dependency) ──────────────────────────────
    const instance = new ec2.CfnInstance(this, 'Instance', {
      instanceType: instanceType.toString(),
      imageId: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }).getImage(this).imageId,
      securityGroupIds: [this.securityGroup.securityGroupId],
      iamInstanceProfile: instanceRole.roleName,
      userData: cdk.Fn.base64(userData.render()),
      keyName: keyPairName,
      subnetId: publicSubnet1.ref,
      blockDeviceMappings: [
        {
          deviceName: '/dev/xvda',
          ebs: {
            volumeSize: 20,
            volumeType: 'gp3',
            encrypted: true,
            deleteOnTermination: true,
          },
        },
      ],
      tags: [
        { key: 'Name', value: 'TodoAppEc2Stack/Instance' },
        { key: 'Project', value: 'TodoApp' },
        { key: 'Environment', value: 'production' },
        { key: 'ManagedBy', value: 'CDK' },
      ],
    });
    this.instanceId = instance.ref;

    // ─── Elastic IP (optional, for stable public IP) ──────────────────────────
    const eip = new ec2.CfnEIP(this, 'InstanceEIP', {
      domain: 'vpc',
      instanceId: instance.ref,
      tags: [{ key: 'Name', value: 'TodoApp-EIP' }],
    });

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.ref,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: instance.attrPublicIp,
      description: 'EC2 Instance Public IP',
    });

    new cdk.CfnOutput(this, 'InstancePublicDns', {
      value: instance.attrPublicDnsName,
      description: 'EC2 Instance Public DNS',
    });

    new cdk.CfnOutput(this, 'ElasticIp', {
      value: eip.ref,
      description: 'Elastic IP for the instance',
    });

    new cdk.CfnOutput(this, 'SshCommand', {
      value: `ssh -i ~/.ssh/${keyPairName || 'your-key'}.pem ec2-user@${instance.attrPublicDnsName}`,
      description: 'SSH command to connect to the instance',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      description: 'Database secret ARN in Secrets Manager',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.ref,
      description: 'VPC ID',
    });

    // ─── Tags ─────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Project', 'TodoApp');
    cdk.Tags.of(this).add('Environment', 'production');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}