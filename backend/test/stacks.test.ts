import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AdminControlPlaneStack } from "../lib/admin-control-plane-stack";
import { BffStack } from "../lib/bff-stack";
import { IdentityStack } from "../lib/identity-stack";
import { IotHubStack } from "../lib/iot-hub-stack";
import { MarketBillingStack } from "../lib/market-billing-stack";
import { VppEventBus } from "../lib/shared/event-bus";
import { DEFAULT_STAGE } from "../lib/shared/constants";

describe("CDK Stacks", () => {
  let app: cdk.App;
  let eventBus: VppEventBus;

  beforeEach(() => {
    app = new cdk.App();
    const sharedStack = new cdk.Stack(app, "TestShared");
    eventBus = new VppEventBus(sharedStack, "TestEventBus", DEFAULT_STAGE);
  });

  test("BffStack creates HTTP API and Lambda functions", () => {
    const stack = new BffStack(app, "TestBff", {
      stage: DEFAULT_STAGE,
      eventBus: eventBus.bus,
    });

    const template = Template.fromStack(stack);

    // Should have an HTTP API
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);

    // Should have 4 Lambda functions (dashboard, assets, trades, revenue-trend)
    template.resourceCountIs("AWS::Lambda::Function", 4);
  });

  test("MarketBillingStack creates Lambda functions", () => {
    const stack = new MarketBillingStack(app, "TestMarketBilling", {
      stage: DEFAULT_STAGE,
      eventBus: eventBus.bus,
    });

    const template = Template.fromStack(stack);

    // Should have 2 Lambda functions (get-tariff-schedule, calculate-profit)
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  // ── IaC Compliance Assertions ─────────────────────────────────────────

  describe("MarketBillingStack — IaC compliance", () => {
    let template: Template;
    let templateJson: Record<string, any>;

    beforeEach(() => {
      const stack = new MarketBillingStack(app, "TestCompliance", {
        stage: DEFAULT_STAGE,
        eventBus: eventBus.bus,
      });
      template = Template.fromStack(stack);
      templateJson = template.toJSON();
    });

    test("natGateways = 0 (cost lockdown — no NAT Gateway)", () => {
      template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    test("VPC Interface Endpoint exists (Secrets Manager privileged channel)", () => {
      template.resourceCountIs("AWS::EC2::VPCEndpoint", 1);
    });

    test("no Security Group allows 0.0.0.0/0 or ::/0 inbound (security lockdown)", () => {
      const resources = templateJson.Resources as Record<string, any>;
      const sgResources = Object.values(resources).filter(
        (r: any) => r.Type === "AWS::EC2::SecurityGroup",
      );

      // Should have at least 1 SG (Lambda, RDS, Endpoint)
      expect(sgResources.length).toBeGreaterThanOrEqual(1);

      for (const sg of sgResources) {
        const ingress = (sg as any).Properties?.SecurityGroupIngress ?? [];
        for (const rule of ingress) {
          expect(rule.CidrIp).not.toBe("0.0.0.0/0");
          expect(rule.CidrIpv6).not.toBe("::/0");
        }
      }
    });
  });
});

describe("IdentityStack — IAM compliance", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  test("selfSignUpEnabled = false (B2B: admin creates accounts only)", () => {
    const stack = new IdentityStack(app, "TestIdentity");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: true,
      },
    });
  });

  test("custom:orgId and custom:role attributes exist in schema", () => {
    const stack = new IdentityStack(app, "TestIdentity2");
    const template = Template.fromStack(stack);

    const pools = template.findResources("AWS::Cognito::UserPool");
    const poolProps = Object.values(pools)[0].Properties;
    const schemaNames = (poolProps.Schema ?? []).map(
      (s: { Name: string }) => s.Name,
    );

    expect(schemaNames).toContain("orgId");
    expect(schemaNames).toContain("role");
  });

  test("WebClient has no client secret (SPA cannot store secrets)", () => {
    const stack = new IdentityStack(app, "TestIdentity3");
    const template = Template.fromStack(stack);

    // GenerateSecret must be absent or false
    const clients = template.findResources("AWS::Cognito::UserPoolClient");
    for (const client of Object.values(clients)) {
      const props = (client as { Properties?: { GenerateSecret?: boolean } })
        .Properties;
      expect(props?.GenerateSecret).not.toBe(true);
    }
  });

  test("3 user groups created: SOLFACIL_ADMIN, ORG_MANAGER, ORG_VIEWER", () => {
    const stack = new IdentityStack(app, "TestIdentity4");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Cognito::UserPoolGroup", 3);

    const groups = template.findResources("AWS::Cognito::UserPoolGroup");
    const names = Object.values(groups).map(
      (g: { Properties?: { GroupName?: string } }) => g.Properties?.GroupName,
    );
    expect(names).toContain("SOLFACIL_ADMIN");
    expect(names).toContain("ORG_MANAGER");
    expect(names).toContain("ORG_VIEWER");
  });
});

// ── Module 8: AdminControlPlaneStack ─────────────────────────────────

describe("AdminControlPlaneStack — IaC compliance", () => {
  let app: cdk.App;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    const stack = new AdminControlPlaneStack(app, "TestAdminControlPlane", {
      stage: DEFAULT_STAGE,
    });
    template = Template.fromStack(stack);
  });

  test("creates AppConfig Application (count = 1)", () => {
    template.resourceCountIs("AWS::AppConfig::Application", 1);
  });

  test("creates AppConfig Environment (count = 1)", () => {
    template.resourceCountIs("AWS::AppConfig::Environment", 1);
  });

  test("creates 7 Configuration Profiles (M1–M7)", () => {
    template.resourceCountIs("AWS::AppConfig::ConfigurationProfile", 7);
  });

  test("creates 7 Lambda Functions (4 CRUD + 3 dictionary handlers)", () => {
    template.resourceCountIs("AWS::Lambda::Function", 7);
  });

  test("creates HTTP API Gateway (count = 1)", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });

  test("all 7 Lambdas have X-Ray tracing Active", () => {
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, any>;
    const lambdas = Object.values(resources).filter(
      (r: any) => r.Type === "AWS::Lambda::Function",
    );

    expect(lambdas).toHaveLength(7);
    for (const fn of lambdas) {
      expect((fn as any).Properties.TracingConfig).toEqual({
        Mode: "Active",
      });
    }
  });
});

// ── X-Ray Global Compliance ──────────────────────────────────────────

describe("X-Ray tracing compliance", () => {
  test("IotHubStack — all Lambdas have TracingConfig.Mode = Active", () => {
    const app = new cdk.App();
    const sharedStack = new cdk.Stack(app, "TestSharedXRay");
    const eventBus = new VppEventBus(
      sharedStack,
      "TestEventBusXRay",
      DEFAULT_STAGE,
    );

    const stack = new IotHubStack(app, "TestIotHubXRay", {
      eventBus: eventBus.bus,
    });
    const template = Template.fromStack(stack);
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, any>;
    const lambdas = Object.values(resources).filter(
      (r: any) => r.Type === "AWS::Lambda::Function",
    );

    expect(lambdas.length).toBeGreaterThanOrEqual(2);
    for (const fn of lambdas) {
      expect((fn as any).Properties.TracingConfig).toEqual({
        Mode: "Active",
      });
    }
  });

  test("BffStack — all Lambdas have TracingConfig.Mode = Active", () => {
    const app = new cdk.App();
    const sharedStack = new cdk.Stack(app, "TestSharedXRayBff");
    const eventBus = new VppEventBus(
      sharedStack,
      "TestEventBusXRayBff",
      DEFAULT_STAGE,
    );

    const stack = new BffStack(app, "TestBffXRay", {
      stage: DEFAULT_STAGE,
      eventBus: eventBus.bus,
    });
    const template = Template.fromStack(stack);
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, any>;
    const lambdas = Object.values(resources).filter(
      (r: any) => r.Type === "AWS::Lambda::Function",
    );

    expect(lambdas.length).toBeGreaterThanOrEqual(4);
    for (const fn of lambdas) {
      expect((fn as any).Properties.TracingConfig).toEqual({
        Mode: "Active",
      });
    }
  });
});

// ── AppConfig IAM Compliance ──────────────────────────────────────────

describe("AppConfig IAM compliance", () => {
  test("IotHubStack — Lambda has AppConfig read permissions in IAM Policy", () => {
    const app = new cdk.App();
    const sharedStack = new cdk.Stack(app, "TestSharedIAM");
    const eventBus = new VppEventBus(
      sharedStack,
      "TestEventBusIAM",
      DEFAULT_STAGE,
    );

    const stack = new IotHubStack(app, "TestIotHubIAM", {
      eventBus: eventBus.bus,
    });
    const template = Template.fromStack(stack);

    // Assert that at least one IAM Policy in this Stack grants AppConfig read access.
    // This prevents any engineer from accidentally removing the permission without tests failing.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "appconfig:StartConfigurationSession",
              "appconfig:GetLatestConfiguration",
            ]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });
});
