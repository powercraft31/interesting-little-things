import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { resourceName, type Stage } from './constants';

/**
 * Shared EventBridge bus construct.
 * All modules publish and subscribe through this single bus.
 */
export class VppEventBus extends Construct {
  public readonly bus: events.EventBus;

  constructor(scope: Construct, id: string, stage: Stage) {
    super(scope, id);

    this.bus = new events.EventBus(this, 'EventBus', {
      eventBusName: resourceName(stage, 'EventBus'),
    });

    // Archive all events for 14 days (debugging & replay)
    new events.Archive(this, 'EventArchive', {
      sourceEventBus: this.bus,
      archiveName: resourceName(stage, 'EventArchive'),
      retention: cdk.Duration.days(14),
      eventPattern: { account: [cdk.Stack.of(this).account] },
    });
  }
}
