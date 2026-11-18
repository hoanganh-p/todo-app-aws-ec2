import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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
export declare class TodoAppEc2Stack extends cdk.Stack {
    readonly vpc: ec2.Vpc;
    readonly instance: ec2.Instance;
    readonly securityGroup: ec2.SecurityGroup;
    constructor(scope: Construct, id: string, props?: TodoAppEc2StackProps);
}
