import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import * as path from "path";
import { resourceName, type Stage } from "./shared/constants";

export interface BffStackProps extends cdk.StackProps {
  readonly stage: Stage;
  readonly eventBus: events.IEventBus;
}

/**
 * Module 5 — BFF (Backend-For-Frontend)
 *
 * Provides the REST API consumed by the React dashboard.
 * Phase 1: Hello-world handlers behind HTTP API Gateway.
 * Later phases: Cognito authorizer, real business logic.
 */
export class BffStack extends cdk.Stack {
  /** Exposed so the frontend can reference the API URL */
  public readonly apiUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: BffStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ── HTTP API Gateway ───────────────────────────────────────────
    const httpApi = new apigateway.HttpApi(this, "BffApi", {
      apiName: resourceName(stage, "BffApi"),
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // ── Lambda Handlers ────────────────────────────────────────────
    const handlersDir = path.join(__dirname, "..", "src", "bff", "handlers");

    const getDashboard = this.createHandler(
      "GetDashboard",
      handlersDir,
      "get-dashboard.handler",
      stage,
    );
    const getAssets = this.createHandler(
      "GetAssets",
      handlersDir,
      "get-assets.handler",
      stage,
    );
    const getTrades = this.createHandler(
      "GetTrades",
      handlersDir,
      "get-trades.handler",
      stage,
    );
    const getRevenueTrend = this.createHandler(
      "GetRevenueTrend",
      handlersDir,
      "get-revenue-trend.handler",
      stage,
    );

    // ── Route Bindings ─────────────────────────────────────────────
    this.addRoute(httpApi, "GET", "/dashboard", getDashboard);
    this.addRoute(httpApi, "GET", "/assets", getAssets);
    this.addRoute(httpApi, "GET", "/trades", getTrades);
    this.addRoute(httpApi, "GET", "/revenue-trend", getRevenueTrend);

    // ── Outputs ────────────────────────────────────────────────────
    this.apiUrl = new cdk.CfnOutput(this, "BffApiUrl", {
      value: httpApi.apiEndpoint,
      description: "BFF HTTP API endpoint URL",
    });
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

  /** Adds a route to the HTTP API */
  private addRoute(
    api: apigateway.HttpApi,
    method: string,
    routePath: string,
    handler: nodejs.NodejsFunction,
  ): void {
    const httpMethod =
      method === "POST"
        ? apigateway.HttpMethod.POST
        : apigateway.HttpMethod.GET;

    api.addRoutes({
      path: routePath,
      methods: [httpMethod],
      integration: new integrations.HttpLambdaIntegration(
        `${handler.node.id}Integration`,
        handler,
      ),
    });
  }
}
