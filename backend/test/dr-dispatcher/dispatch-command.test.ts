import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// ---------------------------------------------------------------------------
// Mock SDK clients BEFORE importing handler (module-level singletons)
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);
const iotMock = mockClient(IoTDataPlaneClient);
const sqsMock = mockClient(SQSClient);

// Set env vars before importing handler
process.env.TABLE_NAME = "dispatch_tracker";
process.env.QUEUE_URL =
  "https://sqs.us-east-1.amazonaws.com/123456/timeout-queue";
process.env.IOT_ENDPOINT = "a1b2c3d4e5f6g7-ats.iot.us-east-1.amazonaws.com";

import { handler } from "../../src/dr-dispatcher/handlers/dispatch-command";

// ---------------------------------------------------------------------------
// Test event factory
// ---------------------------------------------------------------------------

function makeDRCommandEvent(
  overrides: Partial<{
    dispatchId: string;
    assetId: string;
    targetMode: string;
    orgId: string;
  }> = {},
) {
  return {
    "detail-type": "DRCommandIssued",
    detail: {
      dispatchId: overrides.dispatchId ?? "dispatch-001",
      assetId: overrides.assetId ?? "ASSET_SP_001",
      targetMode: overrides.targetMode ?? "peak_shaving",
      orgId: overrides.orgId ?? "ORG_ENERGIA_001",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatch-command handler", () => {
  beforeEach(() => {
    ddbMock.reset();
    iotMock.reset();
    sqsMock.reset();
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("happy path: DB Put → MQTT Publish → SQS Send all succeed", async () => {
    ddbMock.on(PutCommand).resolves({});
    iotMock.on(PublishCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({});

    await expect(handler(makeDRCommandEvent())).resolves.toBeUndefined();

    // Verify DynamoDB PutCommand was called with correct params
    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.TableName).toBe("dispatch_tracker");
    expect(putCalls[0].args[0].input.Item).toMatchObject({
      dispatchId: "dispatch-001",
      assetId: "ASSET_SP_001",
      status: "EXECUTING",
      targetMode: "peak_shaving",
      orgId: "ORG_ENERGIA_001",
    });

    // Verify MQTT Publish was called with correct topic
    const pubCalls = iotMock.commandCalls(PublishCommand);
    expect(pubCalls).toHaveLength(1);
    expect(pubCalls[0].args[0].input.topic).toBe(
      "solfacil/ORG_ENERGIA_001/ASSET_SP_001/command/mode",
    );

    // Deep verify MQTT payload: decode Uint8Array → JSON
    const mqttPayload = JSON.parse(
      new TextDecoder().decode(pubCalls[0].args[0].input.payload as Uint8Array),
    );
    expect(mqttPayload.targetMode).toBe("peak_shaving");
    expect(mqttPayload.dispatchId).toBe("dispatch-001");

    // Verify SQS SendMessage was called with correct QueueUrl
    const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
    expect(sqsCalls).toHaveLength(1);
    expect(sqsCalls[0].args[0].input.QueueUrl).toBe(process.env.QUEUE_URL);

    // Deep verify SQS MessageBody: JSON.parse → assert fields
    const sqsBody = JSON.parse(sqsCalls[0].args[0].input.MessageBody!);
    expect(sqsBody.dispatchId).toBe("dispatch-001");
    expect(sqsBody.assetId).toBe("ASSET_SP_001");
  });

  it("MQTT failure: marks dispatch as FAILED via DynamoDB UpdateCommand", async () => {
    ddbMock.on(PutCommand).resolves({});
    iotMock.on(PublishCommand).rejects(new Error("MQTT connection lost"));
    ddbMock.on(UpdateCommand).resolves({}); // markFailed call

    await expect(handler(makeDRCommandEvent())).rejects.toThrow(
      "MQTT connection lost",
    );

    // Verify PutCommand was called (Step 1 succeeded)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);

    // Verify UpdateCommand was called to mark FAILED
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(
      updateCalls[0].args[0].input.ExpressionAttributeValues,
    ).toMatchObject({
      ":s": "FAILED",
    });

    // Verify SQS was NOT called (execution stops after MQTT failure)
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("DynamoDB PutCommand failure: throws immediately, no MQTT or SQS calls", async () => {
    ddbMock.on(PutCommand).rejects(new Error("DynamoDB throttled"));

    await expect(handler(makeDRCommandEvent())).rejects.toThrow(
      "DynamoDB throttled",
    );

    // Verify no MQTT or SQS calls were made
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("SQS failure: throws error (DB and MQTT already succeeded)", async () => {
    ddbMock.on(PutCommand).resolves({});
    iotMock.on(PublishCommand).resolves({});
    sqsMock.on(SendMessageCommand).rejects(new Error("SQS unavailable"));

    await expect(handler(makeDRCommandEvent())).rejects.toThrow(
      "SQS unavailable",
    );

    // DB and MQTT were called
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(1);
  });
});
