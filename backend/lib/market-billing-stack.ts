import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import * as path from "path";
import { type Stage } from "./shared/constants";

export interface MarketBillingStackProps extends cdk.StackProps {
  readonly stage: Stage;
  readonly eventBus: events.IEventBus;
}

/**
 * Module 4 — Market & Billing
 *
 * Manages tariff schedules (Tarifa Branca), trade logging,
 * revenue calculations, and invoice generation.
 *
 * Infrastructure: VPC (isolated subnets) + RDS PostgreSQL 15 + Lambdas.
 */
export class MarketBillingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MarketBillingStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const handlersDir = path.join(
      __dirname,
      "..",
      "src",
      "market-billing",
      "handlers",
    );

    // ── 1. VPC (dev cost-saving: no NAT Gateway) ─────────────────────
    // DEV: natGateways=0 saves ~$32/month. PROD: change to natGateways=1
    const vpc = new ec2.Vpc(this, "VPC", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ── 2. Security Groups ───────────────────────────────────────────
    // Lambda SG — no inbound, all outbound
    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSG", {
      vpc,
      allowAllOutbound: true,
    });

    // RDS SG — only accepts port 5432 from Lambda SG
    const rdsSg = new ec2.SecurityGroup(this, "RDSSG", {
      vpc,
      allowAllOutbound: false,
    });
    rdsSg.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      "Allow Lambda to access PostgreSQL",
    );

    // ── 3. RDS PostgreSQL 15 ─────────────────────────────────────────
    const db = new rds.DatabaseInstance(this, "DB", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      credentials: rds.Credentials.fromGeneratedSecret("vpp_admin"),
      databaseName: "vpp_db",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSg],
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // TODO PROD: set true
      multiAz: false, // TODO PROD: set true
    });

    // ── 4. GetTariffSchedule Lambda (VPC-connected) ──────────────────
    const tariffFn = new nodejs.NodejsFunction(this, "GetTariffSchedule", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(handlersDir, "get-tariff-schedule.ts"),
      handler: "handler",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        STAGE: stage,
        NODE_OPTIONS: "--enable-source-maps",
        DB_SECRET_ARN: db.secret!.secretArn,
        DATABASE_URL: "", // resolved at runtime from DB_SECRET_ARN
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    db.secret!.grantRead(tariffFn);

    // ── 5. CalculateProfit Lambda (no VPC needed) ────────────────────
    this.createHandler(
      "CalculateProfit",
      handlersDir,
      "calculate-profit.handler",
      stage,
    );

    // ── 6. Stack Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, "TariffFnArn", { value: tariffFn.functionArn });
    new cdk.CfnOutput(this, "DbSecretArn", { value: db.secret!.secretArn });
    new cdk.CfnOutput(this, "SchemaSqlPath", {
      value: "backend/src/market-billing/schema.sql",
      description: "Execute this SQL against vpp_db after first deploy",
    });
    // ============================================================
    // POST-DEPLOY MANUAL STEP:
    // Connect via Bastion Host or RDS Data API and run schema.sql
    // ============================================================

    // ── EventBridge wiring will be added in Phase 2 ────────────────
    // Placeholder: subscribe to AssetModeChanged, ScheduleGenerated
    // Placeholder: publish ProfitCalculated, InvoiceGenerated
  }

  /** Factory: creates a Node.js 22 Lambda bundled with esbuild */
  private createHandler(
    id: string,
    handlersDir: string,
    entry: string,
    stage: Stage,
  ): nodejs.NodejsFunction {
    const [fileName, exportName] = entry.split(".");
    return new nodejs.NodejsFunction(this, id, {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(handlersDir, `${fileName}.ts`),
      handler: exportName,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        STAGE: stage,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
  }
}
