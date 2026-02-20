import * as cdk from "aws-cdk-lib";
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
 * Phase 1: Skeleton Lambdas only — no RDS/PostgreSQL yet.
 * Later phases: RDS Serverless v2, ElastiCache, real billing logic.
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

    // ── Lambda Handlers (skeleton) ─────────────────────────────────
    this.createHandler(
      "GetTariffSchedule",
      handlersDir,
      "get-tariff-schedule.handler",
      stage,
    );
    this.createHandler(
      "CalculateProfit",
      handlersDir,
      "calculate-profit.handler",
      stage,
    );

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
