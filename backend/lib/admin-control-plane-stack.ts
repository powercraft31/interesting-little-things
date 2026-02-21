import * as cdk from "aws-cdk-lib";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

interface AdminControlPlaneStackProps extends cdk.StackProps {
  readonly stage: string;
}

/**
 * Module 8 — Admin Control Plane
 *
 * Manages AppConfig infrastructure (Application + Environment + 7 Profiles)
 * and the M8 CRUD Lambda handlers behind an HTTP API Gateway.
 */
export class AdminControlPlaneStack extends cdk.Stack {
  /** Exposed so other Stacks can reference AppConfig ARNs */
  public readonly appConfigApplicationId: string;
  public readonly appConfigEnvironmentId: string;

  constructor(
    scope: Construct,
    id: string,
    props: AdminControlPlaneStackProps,
  ) {
    super(scope, id, props);

    // ── AppConfig Application ─────────────────────────────────────
    const application = new appconfig.CfnApplication(
      this,
      "VppAppConfigApp",
      {
        name: `solfacil-vpp-${props.stage}`,
      },
    );

    // ── AppConfig Environment ─────────────────────────────────────
    const environment = new appconfig.CfnEnvironment(
      this,
      "VppAppConfigEnv",
      {
        applicationId: application.ref,
        name: props.stage,
      },
    );

    // ── 7 Configuration Profiles (M1–M7) ─────────────────────────
    const profiles = [
      { id: "ParserRules", name: "parser-rules" },
      { id: "VppStrategies", name: "vpp-strategies" },
      { id: "DispatchPolicies", name: "dispatch-policies" },
      { id: "BillingRules", name: "billing-rules" },
      { id: "FeatureFlags", name: "feature-flags" },
      { id: "RbacPolicies", name: "rbac-policies" },
      { id: "ApiQuotas", name: "api-quotas" },
    ];

    for (const profile of profiles) {
      new appconfig.CfnConfigurationProfile(this, `Profile${profile.id}`, {
        applicationId: application.ref,
        name: profile.name,
        locationUri: "hosted",
        type: "AWS.Freeform",
      });
    }

    this.appConfigApplicationId = application.ref;
    this.appConfigEnvironmentId = environment.ref;

    // ── Lambda Helper ─────────────────────────────────────────────
    const makeAdminLambda = (functionId: string, entryPath: string) =>
      new nodejs.NodejsFunction(this, functionId, {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(
          __dirname,
          "..",
          "src",
          "admin-control-plane",
          "handlers",
          entryPath,
        ),
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          STAGE: props.stage,
        },
        bundling: { externalModules: ["pg-native"] },
      });

    const getParserRulesFn = makeAdminLambda(
      "GetParserRules",
      "get-parser-rules.ts",
    );
    const createParserRuleFn = makeAdminLambda(
      "CreateParserRule",
      "create-parser-rule.ts",
    );
    const getStrategiesFn = makeAdminLambda(
      "GetVppStrategies",
      "get-vpp-strategies.ts",
    );
    const updateStrategyFn = makeAdminLambda(
      "UpdateVppStrategy",
      "update-vpp-strategy.ts",
    );

    // ── API Gateway ───────────────────────────────────────────────
    const adminApi = new apigwv2.HttpApi(this, "AdminApi", {
      apiName: `solfacil-vpp-admin-${props.stage}`,
      corsPreflight: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });

    adminApi.addRoutes({
      path: "/admin/parsers",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "GetParserRulesIntegration",
        getParserRulesFn,
      ),
    });
    adminApi.addRoutes({
      path: "/admin/parsers",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "CreateParserRuleIntegration",
        createParserRuleFn,
      ),
    });
    adminApi.addRoutes({
      path: "/admin/strategies",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "GetStrategiesIntegration",
        getStrategiesFn,
      ),
    });
    adminApi.addRoutes({
      path: "/admin/strategies/{id}",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "UpdateStrategyIntegration",
        updateStrategyFn,
      ),
    });

    // ── Outputs ───────────────────────────────────────────────────
    new cdk.CfnOutput(this, "AdminApiUrl", {
      value: adminApi.apiEndpoint,
      exportName: `SolfacilVpp-${props.stage}-AdminApiUrl`,
    });
    new cdk.CfnOutput(this, "AppConfigApplicationId", {
      value: application.ref,
      exportName: `SolfacilVpp-${props.stage}-AppConfigApplicationId`,
    });
    new cdk.CfnOutput(this, "AppConfigEnvironmentId", {
      value: environment.ref,
      exportName: `SolfacilVpp-${props.stage}-AppConfigEnvironmentId`,
    });
  }
}
