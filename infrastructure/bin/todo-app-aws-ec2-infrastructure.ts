#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TodoAppEc2Stack } from '../lib/todo-app-ec2-stack';

const app = new cdk.App();

new TodoAppEc2Stack(app, 'TodoAppEc2Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '262232992721',
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Todo App Infrastructure - EC2 with Docker Compose, Nginx, PostgreSQL',
  keyPairName: process.env.KEY_PAIR_NAME,
});