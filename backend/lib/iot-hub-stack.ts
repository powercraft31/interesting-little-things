import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as iot from "aws-cdk-lib/aws-iot";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as timestream from "aws-cdk-lib/aws-timestream";
import { Construct } from "constructs";
import * as path from "path";
import { EVENT_SOURCE, EVENT_DETAIL_TYPE } from "./shared/event-schemas";

export interface IotHubStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
}

/**
 * Module 1 — IoT Hub
 *
 * Manages device telemetry ingestion (MQTT → IoT Rule → Lambda → Timestream)
 * and schedule-to-shadow synchronisation (EventBridge → Lambda → Device Shadow).
 *
 * Phase 2a: Infrastructure only — skeleton handlers, no business logic yet.
 */
export class IotHubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IotHubStackProps) {
    super(scope, id, props);

    const { eventBus } = props;
    const handlersDir = path.join(
      __dirname,
      "..",
      "src",
      "iot-hub",
      "handlers",
    );

    // ── Timestream Database & Table ───────────────────────────────────
    const tsDatabase = new timestream.CfnDatabase(this, "TimestreamDb", {
      databaseName: "solfacil_vpp",
    });

    const tsTable = new timestream.CfnTable(this, "TelemetryTable", {
      databaseName: tsDatabase.databaseName!,
      tableName: "device_telemetry",
      retentionProperties: {
        memoryStoreRetentionPeriodInHours: "24",
        magneticStoreRetentionPeriodInDays: "365",
      },
    });
    tsTable.addDependency(tsDatabase);

    // ── Ingest Telemetry Lambda ──────────────────────────────────────
    const ingestTelemetryFn = new nodejs.NodejsFunction(
      this,
      "IngestTelemetry",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(handlersDir, "ingest-telemetry.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          TIMESTREAM_DB_NAME: tsDatabase.databaseName!,
          TIMESTREAM_TABLE_NAME: tsTable.tableName!,
          NODE_OPTIONS: "--enable-source-maps",
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    // IAM: allow Lambda to write to Timestream
    ingestTelemetryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["timestream:WriteRecords", "timestream:DescribeEndpoints"],
        resources: [
          tsTable.attrArn,
          // DescribeEndpoints requires wildcard
          `arn:aws:timestream:${this.region}:${this.account}:*`,
        ],
      }),
    );

    // IAM: allow Lambda to read AppConfig (runtime config hot-reload)
    ingestTelemetryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "appconfig:StartConfigurationSession",
          "appconfig:GetLatestConfiguration",
        ],
        resources: ["*"],
      }),
    );

    // ── IoT Topic Rule → Ingest Lambda ───────────────────────────────
    const iotRuleRole = new iam.Role(this, "IoTRuleRole", {
      assumedBy: new iam.ServicePrincipal("iot.amazonaws.com"),
    });
    ingestTelemetryFn.grantInvoke(iotRuleRole);

    new iot.CfnTopicRule(this, "TelemetryIngestionRule", {
      ruleName: "SolfacilTelemetryIngestion",
      topicRulePayload: {
        sql: "SELECT *, topic(2) as device_id, topic(3) as asset_type FROM 'solfacil/+/+/telemetry'",
        awsIotSqlVersion: "2016-03-23",
        actions: [
          {
            lambda: {
              functionArn: ingestTelemetryFn.functionArn,
            },
          },
        ],
      },
    });

    // Grant IoT service permission to invoke the Lambda
    ingestTelemetryFn.addPermission("AllowIoTInvoke", {
      principal: new iam.ServicePrincipal("iot.amazonaws.com"),
      sourceArn: `arn:aws:iot:${this.region}:${this.account}:rule/SolfacilTelemetryIngestion`,
    });

    // ── Schedule-to-Shadow Lambda ────────────────────────────────────
    const scheduleToShadowFn = new nodejs.NodejsFunction(
      this,
      "ScheduleToShadow",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(handlersDir, "schedule-to-shadow.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          NODE_OPTIONS: "--enable-source-maps",
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    // IAM: allow Lambda to manage Device Shadows
    scheduleToShadowFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:UpdateThingShadow", "iot:GetThingShadow"],
        resources: [`arn:aws:iot:${this.region}:${this.account}:thing/*`],
      }),
    );

    // ── EventBridge Rule: ScheduleGenerated → schedule-to-shadow ─────
    new events.Rule(this, "ScheduleGeneratedRule", {
      eventBus,
      eventPattern: {
        source: [EVENT_SOURCE.OPTIMIZATION],
        detailType: [EVENT_DETAIL_TYPE.SCHEDULE_GENERATED],
      },
      targets: [new targets.LambdaFunction(scheduleToShadowFn)],
    });
  }
}
