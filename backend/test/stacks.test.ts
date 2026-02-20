import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { BffStack } from "../lib/bff-stack";
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
