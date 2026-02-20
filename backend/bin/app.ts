#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BffStack } from '../lib/bff-stack';
import { MarketBillingStack } from '../lib/market-billing-stack';
import { VppEventBus } from '../lib/shared/event-bus';
import { DEFAULT_STAGE } from '../lib/shared/constants';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string) || DEFAULT_STAGE;

// ── Shared Resources ───────────────────────────────────────────────
const sharedStack = new cdk.Stack(app, `SolfacilVpp-${stage}-Shared`, {
  description: 'Shared resources: EventBridge bus',
});
const eventBus = new VppEventBus(sharedStack, 'VppEventBus', DEFAULT_STAGE);

// ── Module 4: Market & Billing ─────────────────────────────────────
new MarketBillingStack(app, `SolfacilVpp-${stage}-MarketBilling`, {
  stage: DEFAULT_STAGE,
  eventBus: eventBus.bus,
  description: 'Module 4: Tariff management, trades, revenue & invoicing',
});

// ── Module 5: BFF ──────────────────────────────────────────────────
new BffStack(app, `SolfacilVpp-${stage}-Bff`, {
  stage: DEFAULT_STAGE,
  eventBus: eventBus.bus,
  description: 'Module 5: REST API Gateway for the React dashboard',
});

app.synth();
