import { publishSubDevicesGet } from "../../src/iot-hub/handlers/publish-config";

describe("publishSubDevicesGet", () => {
  it("publishes to correct topic with correct payload", () => {
    const mockPublish = jest.fn();
    publishSubDevicesGet("WKRD24070202100144F", mockPublish);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msgStr] = mockPublish.mock.calls[0];
    expect(topic).toBe("platform/ems/WKRD24070202100144F/subDevices/get");

    const msg = JSON.parse(msgStr);
    expect(msg.clientId).toBe("WKRD24070202100144F");
    expect(msg.data.reason).toBe("periodic_query");
    expect(msg.productKey).toBe("ems");
    expect(msg.DS).toBe(0);
    expect(msg.ackFlag).toBe(0);
  });

  it("generates unique messageId per call", () => {
    const mockPublish = jest.fn();
    jest.useFakeTimers();

    publishSubDevicesGet("CID1", mockPublish);
    jest.advanceTimersByTime(1);
    publishSubDevicesGet("CID1", mockPublish);

    const msg1 = JSON.parse(mockPublish.mock.calls[0][1]);
    const msg2 = JSON.parse(mockPublish.mock.calls[1][1]);
    expect(msg1.messageId).toBeDefined();
    expect(msg2.messageId).toBeDefined();

    jest.useRealTimers();
  });

  it("includes deviceName and timeStamp", () => {
    const mockPublish = jest.fn();
    publishSubDevicesGet("CID1", mockPublish);

    const msg = JSON.parse(mockPublish.mock.calls[0][1]);
    expect(msg.deviceName).toBe("EMS_N2");
    expect(msg.timeStamp).toBeDefined();
  });
});
