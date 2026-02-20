import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// ---------------------------------------------------------------------------
// Mock SDK clients BEFORE importing handler
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Set env vars before importing handler
process.env.TABLE_NAME = 'dispatch_tracker';
process.env.EVENT_BUS_NAME = 'SolfacilVpp-dev-EventBus';

import { handler } from '../../src/dr-dispatcher/handlers/collect-response';

// ---------------------------------------------------------------------------
// Test event factory
// ---------------------------------------------------------------------------

function makeDeviceResponseEvent(overrides: Partial<{
  dispatchId: string;
  assetId: string;
  orgId: string;
  status: 'COMPLETED' | 'ERROR';
  errorCode: string;
}> = {}) {
  return {
    dispatchId: overrides.dispatchId ?? 'dispatch-001',
    assetId: overrides.assetId ?? 'ASSET_SP_001',
    orgId: overrides.orgId ?? 'ORG_ENERGIA_001',
    status: overrides.status ?? 'COMPLETED',
    ...(overrides.errorCode ? { errorCode: overrides.errorCode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collect-response handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('happy path: UpdateCommand succeeds → PutEvents succeeds', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({});

    await expect(handler(makeDeviceResponseEvent())).resolves.toBeUndefined();

    // Verify DynamoDB UpdateCommand was called with correct condition
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.ConditionExpression).toBe('#s = :executing');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'COMPLETED',
      ':executing': 'EXECUTING',
    });

    // Verify EventBridge PutEvents was called
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls).toHaveLength(1);
    const entry = ebCalls[0].args[0].input.Entries![0];
    expect(entry.DetailType).toBe('DRDispatchCompleted');
    expect(entry.Source).toBe('solfacil.vpp.dr-dispatcher');
    expect(entry.EventBusName).toBe('SolfacilVpp-dev-EventBus');

    const detail = JSON.parse(entry.Detail!);
    expect(detail).toMatchObject({
      dispatchId: 'dispatch-001',
      assetId: 'ASSET_SP_001',
      orgId: 'ORG_ENERGIA_001',
      status: 'COMPLETED',
    });
  });

  it('handles ERROR status from device', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({});

    await expect(
      handler(makeDeviceResponseEvent({ status: 'ERROR', errorCode: 'BATT_OVERHEAT' })),
    ).resolves.toBeUndefined();

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'ERROR',
    });
  });

  it('idempotency: ConditionalCheckFailedException → silently returns (no throw)', async () => {
    const conditionalError = new Error('The conditional request failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    ddbMock.on(UpdateCommand).rejects(conditionalError);

    // Should NOT throw
    await expect(handler(makeDeviceResponseEvent())).resolves.toBeUndefined();

    // EventBridge should NOT be called (early return)
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('non-conditional DynamoDB error → throws', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('Internal server error'));

    await expect(handler(makeDeviceResponseEvent())).rejects.toThrow(
      'Internal server error',
    );

    // EventBridge should NOT be called
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('EventBridge failure → throws after DynamoDB succeeds', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ebMock.on(PutEventsCommand).rejects(new Error('EventBridge unavailable'));

    await expect(handler(makeDeviceResponseEvent())).rejects.toThrow(
      'EventBridge unavailable',
    );

    // DynamoDB update DID happen
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});
