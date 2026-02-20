import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class IdentityStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── User Pool ───────────────────────────────────────────────────
    // B2B SaaS: admin-only account creation, no self sign-up
    this.userPool = new cognito.UserPool(this, 'VppUserPool', {
      userPoolName: 'solfacil-vpp-users',
      selfSignUpEnabled: false,              // B2B: admin creates accounts only
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // PROD: never accidentally delete
      // Custom attributes for multi-tenant RBAC
      customAttributes: {
        'orgId': new cognito.StringAttribute({ mutable: true }),
        'role':  new cognito.StringAttribute({ mutable: true }),
      },
    });

    // ── User Groups (maps to our Role enum) ─────────────────────────
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'SOLFACIL_ADMIN',
      description: 'Platform administrators — full access across all tenants',
    });
    new cognito.CfnUserPoolGroup(this, 'ManagerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'ORG_MANAGER',
      description: 'Organisation managers — read/write within their org',
    });
    new cognito.CfnUserPoolGroup(this, 'ViewerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'ORG_VIEWER',
      description: 'Organisation viewers — read-only within their org',
    });

    // ── App Client (SPA — no secret) ─────────────────────────────────
    // Frontend SPA cannot safely store a client secret
    this.webClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'solfacil-vpp-spa',
      generateSecret: false,                 // SPA: no client secret
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ── Outputs ────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'WebClientId', { value: this.webClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolArn', { value: this.userPool.userPoolArn });
  }
}
