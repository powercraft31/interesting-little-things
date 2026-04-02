import {
  parseProtocolTimestamp,
  formatProtocolTimestamp,
  epochMsToProtocolTimestamp,
} from "@shared/protocol-time";
import { mapProductType } from "@shared/types/solfacil-protocol";

describe("parseProtocolTimestamp", () => {
  it("parses V2.4 normal timestamp", () => {
    const result = parseProtocolTimestamp("2026-04-01 09:11:22");
    expect(result).toEqual(new Date("2026-04-01T12:11:22.000Z"));
  });

  it("parses V2.4 cross-day timestamp", () => {
    const result = parseProtocolTimestamp("2026-03-31 23:59:59");
    expect(result).toEqual(new Date("2026-04-01T02:59:59.000Z"));
  });

  it("parses V2.4 midnight timestamp", () => {
    const result = parseProtocolTimestamp("2026-04-01 00:00:00");
    expect(result).toEqual(new Date("2026-04-01T03:00:00.000Z"));
  });

  it("parses V1.x epoch ms", () => {
    const result = parseProtocolTimestamp("1773197160320");
    expect(result).toEqual(new Date(1773197160320));
  });

  it("parses V1.x 10-digit minimum epoch ms", () => {
    const result = parseProtocolTimestamp("1000000000000");
    expect(result).toEqual(new Date(1000000000000));
  });

  it("throws on empty string", () => {
    expect(() => parseProtocolTimestamp("")).toThrow(Error);
  });

  it("throws on garbage input", () => {
    expect(() => parseProtocolTimestamp("abc")).toThrow(Error);
  });

  it("throws on out-of-range date", () => {
    expect(() => parseProtocolTimestamp("2026-13-01 99:99:99")).toThrow(Error);
  });

  it("throws on short digits (takes V2.4 path, fails)", () => {
    expect(() => parseProtocolTimestamp("12345")).toThrow(Error);
  });
});

describe("formatProtocolTimestamp", () => {
  it("formats a normal UTC date to UTC-3", () => {
    const result = formatProtocolTimestamp(new Date("2026-04-01T12:11:22.000Z"));
    expect(result).toBe("2026-04-01 09:11:22");
  });

  it("formats cross-day (UTC midnight → previous day in UTC-3)", () => {
    const result = formatProtocolTimestamp(new Date("2026-04-01T00:00:00.000Z"));
    expect(result).toBe("2026-03-31 21:00:00");
  });
});

describe("roundtrip", () => {
  it("format(parse(x)) === x for V2.4 format strings", () => {
    const samples = [
      "2026-04-01 09:11:22",
      "2026-03-31 23:59:59",
      "2026-01-01 00:00:00",
    ];
    for (const x of samples) {
      expect(formatProtocolTimestamp(parseProtocolTimestamp(x))).toBe(x);
    }
  });
});

describe("epochMsToProtocolTimestamp", () => {
  it("converts epoch ms to V2.4 format", () => {
    const d = new Date("2026-04-01T12:11:22.000Z");
    expect(epochMsToProtocolTimestamp(d.getTime())).toBe("2026-04-01 09:11:22");
  });
});

describe("mapProductType", () => {
  it('maps "ess" to INVERTER_BATTERY', () => {
    expect(mapProductType("ess")).toBe("INVERTER_BATTERY");
  });
});
