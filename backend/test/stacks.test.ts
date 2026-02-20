import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BffStack } from '../lib/bff-stack';
import { MarketBillingStack } from '../lib/market-billing-stack';
import { VppEventBus } from '../lib/shared/event-bus';
import { DEFAULT_STAGE } from '../lib/shared/constants';

describe('CDK Stacks', () => {
  let app: cdk.App;
  let eventBus: VppEventBus;

  beforeEach(() => {
    app = new cdk.App();
    const sharedStack = new cdk.Stack(app, 'TestShared');
    eventBus = new VppEventBus(sharedStack, 'TestEventBus', DEFAULT_STAGE);
  });

  test('BffStack creates HTTP API and Lambda functions', () => {
    const stack = new BffStack(app, 'TestBff', {
      stage: DEFAULT_STAGE,
      eventBus: eventBus.bus,
    });

    const template = Template.fromStack(stack);

    // Should have an HTTP API
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);

    // Should have 4 Lambda functions (dashboard, assets, trades, revenue-trend)
    template.resourceCountIs('AWS::Lambda::Function', 4);
  });

  test('MarketBillingStack creates Lambda functions', () => {
    const stack = new MarketBillingStack(app, 'TestMarketBilling', {
      stage: DEFAULT_STAGE,
      eventBus: eventBus.bus,
    });

    const template = Template.fromStack(stack);

    // Should have 2 Lambda functions (get-tariff-schedule, calculate-profit)
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });
});
