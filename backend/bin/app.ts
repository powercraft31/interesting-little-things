#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BffStack } from "../lib/bff-stack";
import { DrDispatcherStack } from "../lib/dr-dispatcher-stack";
import { IotHubStack } from "../lib/iot-hub-stack";
import { MarketBillingStack } from "../lib/market-billing-stack";
import { VppEventBus } from "../lib/shared/event-bus";
import { DEFAULT_STAGE } from "../lib/shared/constants";

const app = new cdk.App();

const stage = (app.node.tryGetContext("stage") as string) || DEFAULT_STAGE;

// ── Shared Resources ───────────────────────────────────────────────
const sharedStack = new cdk.Stack(app, `SolfacilVpp-${stage}-Shared`, {
  description: "Shared resources: EventBridge bus",
});
const eventBus = new VppEventBus(sharedStack, "VppEventBus", DEFAULT_STAGE);

// ── Module 1: IoT Hub ─────────────────────────────────────────────
const iotHubStack = new IotHubStack(app, `SolfacilVpp-${stage}-IotHub`, {
  eventBus: eventBus.bus,
  description: "Module 1: IoT telemetry ingestion & device shadow sync",
});
iotHubStack.addDependency(sharedStack);

// ── Module 3: DR Dispatcher ────────────────────────────────────────
const drDispatcherStack = new DrDispatcherStack(
  app,
  `SolfacilVpp-${stage}-DrDispatcher`,
  {
    eventBus: eventBus.bus,
    description:
      "Module 3: DR command dispatch, device state tracking & timeout queue",
  },
);
drDispatcherStack.addDependency(sharedStack);

// ── Module 4: Market & Billing ─────────────────────────────────────
new MarketBillingStack(app, `SolfacilVpp-${stage}-MarketBilling`, {
  stage: DEFAULT_STAGE,
  eventBus: eventBus.bus,
  description: "Module 4: Tariff management, trades, revenue & invoicing",
});

// ── Module 5: BFF ──────────────────────────────────────────────────
new BffStack(app, `SolfacilVpp-${stage}-Bff`, {
  stage: DEFAULT_STAGE,
  eventBus: eventBus.bus,
  description: "Module 5: REST API Gateway for the React dashboard",
});

app.synth();
