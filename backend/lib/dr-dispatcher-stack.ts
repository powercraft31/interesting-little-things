import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as iot from "aws-cdk-lib/aws-iot";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import * as path from "path";
import { EVENT_SOURCE, EVENT_DETAIL_TYPE } from "./shared/event-schemas";

export interface DrDispatcherStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
}

/**
 * Module 3 — DR Dispatcher
 *
 * Handles demand-response command dispatch, device state tracking,
 * and SQS-based 15-minute timeout queue for non-responding devices.
 *
 * Phase 2b: Infrastructure only — skeleton handlers, no business logic yet.
 */
export class DrDispatcherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DrDispatcherStackProps) {
    super(scope, id, props);

    const { eventBus } = props;
    const handlersDir = path.join(
      __dirname,
      "..",
      "src",
      "dr-dispatcher",
      "handlers",
    );

    // ── DynamoDB: dispatch_tracker ──────────────────────────────────
    const table = new dynamodb.Table(this, "DispatchTracker", {
      tableName: "dispatch_tracker",
      partitionKey: {
        name: "dispatch_id",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "asset_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    table.addGlobalSecondaryIndex({
      indexName: "status-index",
      partitionKey: {
        name: "dispatch_id",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
    });

    // ── SQS: Timeout Queue + Dead-Letter Queue ─────────────────────
    const timeoutDlq = new sqs.Queue(this, "TimeoutDLQ");

    const timeoutQueue = new sqs.Queue(this, "TimeoutQueue", {
      deliveryDelay: cdk.Duration.seconds(900),
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: timeoutDlq,
        maxReceiveCount: 3,
      },
    });

    // ── Lambda: dispatch-command ────────────────────────────────────
    const dispatchCommandFn = new nodejs.NodejsFunction(
      this,
      "DispatchCommand",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(handlersDir, "dispatch-command.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          DISPATCH_TABLE_NAME: table.tableName,
          TIMEOUT_QUEUE_URL: timeoutQueue.queueUrl,
          NODE_OPTIONS: "--enable-source-maps",
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    table.grantWriteData(dispatchCommandFn);
    timeoutQueue.grantSendMessages(dispatchCommandFn);

    dispatchCommandFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:Publish"],
        resources: [
          `arn:aws:iot:${this.region}:${this.account}:topic/solfacil/*`,
        ],
      }),
    );

    // EventBridge Rule: DRCommandIssued → dispatch-command
    new events.Rule(this, "DRCommandIssuedRule", {
      eventBus,
      eventPattern: {
        source: [EVENT_SOURCE.BFF],
        detailType: [EVENT_DETAIL_TYPE.DR_COMMAND_ISSUED],
      },
      targets: [new targets.LambdaFunction(dispatchCommandFn)],
    });

    // ── Lambda: collect-response ───────────────────────────────────
    const collectResponseFn = new nodejs.NodejsFunction(
      this,
      "CollectResponse",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(handlersDir, "collect-response.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          DISPATCH_TABLE_NAME: table.tableName,
          NODE_OPTIONS: "--enable-source-maps",
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    collectResponseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [table.tableArn],
      }),
    );

    // IoT Topic Rule → collect-response
    const collectIotRuleRole = new iam.Role(
      this,
      "CollectResponseIoTRuleRole",
      {
        assumedBy: new iam.ServicePrincipal("iot.amazonaws.com"),
      },
    );
    collectResponseFn.grantInvoke(collectIotRuleRole);

    new iot.CfnTopicRule(this, "ModeChangeResponseRule", {
      ruleName: "SolfacilDrModeChangeResponse",
      topicRulePayload: {
        sql: "SELECT *, topic(2) as device_id, topic(3) as asset_type FROM 'solfacil/+/+/response/mode-change'",
        awsIotSqlVersion: "2016-03-23",
        actions: [
          {
            lambda: {
              functionArn: collectResponseFn.functionArn,
            },
          },
        ],
      },
    });

    collectResponseFn.addPermission("AllowIoTInvoke", {
      principal: new iam.ServicePrincipal("iot.amazonaws.com"),
      sourceArn: `arn:aws:iot:${this.region}:${this.account}:rule/SolfacilDrModeChangeResponse`,
    });

    // ── Lambda: timeout-checker ────────────────────────────────────
    const timeoutCheckerFn = new nodejs.NodejsFunction(this, "TimeoutChecker", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(handlersDir, "timeout-checker.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        DISPATCH_TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    table.grantReadWriteData(timeoutCheckerFn);
    eventBus.grantPutEventsTo(timeoutCheckerFn);

    timeoutCheckerFn.addEventSource(
      new SqsEventSource(timeoutQueue, {
        batchSize: 1,
      }),
    );
  }
}
