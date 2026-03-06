import type { XuhengRawMessage } from "../../src/shared/types/telemetry";
import { classifyMessage } from "../../src/iot-hub/handlers/mqtt-subscriber";

describe("mqtt-subscriber — classifyMessage", () => {
  it("classifies MSG#4 (batList + pvList + gridList)", () => {
    const raw: XuhengRawMessage = {
      clientId: "C1",
      productKey: "ems",
      timeStamp: "123",
      data: {
        batList: [{ deviceSn: "B1", properties: {} as never }],
        pvList: [{ deviceSn: "P1", properties: {} as never }],
        gridList: [{ deviceSn: "G1", properties: {} as never }],
      },
    };
    expect(classifyMessage(raw)).toBe(4);
  });

  it("classifies MSG#0 (emsList)", () => {
    const raw: XuhengRawMessage = {
      clientId: "C1",
      productKey: "ems",
      timeStamp: "123",
      data: {
        emsList: [{ properties: { firmware_version: "v1" } }],
      },
    };
    expect(classifyMessage(raw)).toBe(0);
  });

  it("classifies MSG#1 (didoList)", () => {
    const raw = {
      clientId: "C1",
      productKey: "ems",
      timeStamp: "123",
      data: { didoList: [{}] },
    } as unknown as XuhengRawMessage;
    expect(classifyMessage(raw)).toBe(1);
  });

  it("classifies MSG#2 (meterList)", () => {
    const raw = {
      clientId: "C1",
      productKey: "ems",
      timeStamp: "123",
      data: { meterList: [{}] },
    } as unknown as XuhengRawMessage;
    expect(classifyMessage(raw)).toBe(2);
  });

  it("defaults to MSG#4 for unknown format", () => {
    const raw = {
      clientId: "C1",
      productKey: "ems",
      timeStamp: "123",
      data: { someUnknownList: [{}] },
    } as unknown as XuhengRawMessage;
    expect(classifyMessage(raw)).toBe(4);
  });
});
