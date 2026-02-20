import { mockClient } from 'aws-sdk-client-mock';
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
} from '@aws-sdk/client-timestream-write';
import { handler, type TelemetryEvent } from '../../src/iot-hub/handlers/ingest-telemetry';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const VALID_EVENT: TelemetryEvent = {
  orgId: 'ORG_ENERGIA_001',
  deviceId: 'ASSET_SP_001',
  timestamp: '2026-02-20T14:30:00.000Z',
  metrics: {
    power: 4.8,
    voltage: 220.5,
    current: 21.8,
  },
};

const VALID_EVENT_WITH_SOC: TelemetryEvent = {
  ...VALID_EVENT,
  metrics: { ...VALID_EVENT.metrics, soc: 72.5 },
};

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
const tsMock = mockClient(TimestreamWriteClient);

beforeEach(() => {
  tsMock.reset();
  tsMock.on(WriteRecordsCommand).resolves({});
  process.env.TS_DATABASE_NAME = 'solfacil_telemetry';
  process.env.TS_TABLE_NAME = 'device_metrics';
});

afterEach(() => {
  delete process.env.TS_DATABASE_NAME;
  delete process.env.TS_TABLE_NAME;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ingest-telemetry handler', () => {
  // ---- Happy path ---------------------------------------------------------
  describe('happy path', () => {
    it('calls WriteRecordsCommand with correct Dimensions', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      expect(calls).toHaveLength(1);

      const dimensions = calls[0].args[0].input.Records![0].Dimensions;
      expect(dimensions).toEqual(
        expect.arrayContaining([
          { Name: 'orgId', Value: 'ORG_ENERGIA_001' },
          { Name: 'deviceId', Value: 'ASSET_SP_001' },
        ]),
      );
    });

    it('calls WriteRecordsCommand with correct MeasureValues (power, voltage, current)', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toEqual(
        expect.arrayContaining([
          { Name: 'power', Value: '4.8', Type: 'DOUBLE' },
          { Name: 'voltage', Value: '220.5', Type: 'DOUBLE' },
          { Name: 'current', Value: '21.8', Type: 'DOUBLE' },
        ]),
      );
    });

    it('includes soc in MeasureValues when provided', async () => {
      await handler(VALID_EVENT_WITH_SOC);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toEqual(
        expect.arrayContaining([
          { Name: 'soc', Value: '72.5', Type: 'DOUBLE' },
        ]),
      );
      expect(measureValues).toHaveLength(4);
    });

    it('omits soc from MeasureValues when not provided', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toHaveLength(3);
      expect(measureValues!.map((m) => m.Name)).not.toContain('soc');
    });

    it('converts timestamp to milliseconds string', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const record = calls[0].args[0].input.Records![0];

      const expectedMs = String(new Date('2026-02-20T14:30:00.000Z').getTime());
      expect(record.Time).toBe(expectedMs);
      expect(record.TimeUnit).toBe('MILLISECONDS');
    });

    it('sets MeasureValueType to MULTI and MeasureName to telemetry', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const record = calls[0].args[0].input.Records![0];

      expect(record.MeasureValueType).toBe('MULTI');
      expect(record.MeasureName).toBe('telemetry');
    });

    it('sends correct DatabaseName and TableName from env', async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const input = calls[0].args[0].input;

      expect(input.DatabaseName).toBe('solfacil_telemetry');
      expect(input.TableName).toBe('device_metrics');
    });

    it('returns { success: true, recordsWritten: 1 }', async () => {
      const result = await handler(VALID_EVENT);

      expect(result).toEqual({ success: true, recordsWritten: 1 });
    });
  });

  // ---- Validation ---------------------------------------------------------
  describe('validation', () => {
    it('throws when orgId is missing', async () => {
      const badEvent = { ...VALID_EVENT, orgId: '' } as TelemetryEvent;

      await expect(handler(badEvent)).rejects.toThrow(
        'Missing required field: orgId',
      );

      expect(tsMock.commandCalls(WriteRecordsCommand)).toHaveLength(0);
    });

    it('throws when deviceId is missing', async () => {
      const badEvent = { ...VALID_EVENT, deviceId: '' } as TelemetryEvent;

      await expect(handler(badEvent)).rejects.toThrow(
        'Missing required field: deviceId',
      );

      expect(tsMock.commandCalls(WriteRecordsCommand)).toHaveLength(0);
    });
  });

  // ---- Error propagation --------------------------------------------------
  describe('Timestream write failure', () => {
    it('re-throws the original Timestream error', async () => {
      const tsError = new Error('ThrottlingException: rate exceeded');
      tsMock.on(WriteRecordsCommand).rejects(tsError);

      await expect(handler(VALID_EVENT)).rejects.toThrow(
        'ThrottlingException: rate exceeded',
      );
    });
  });
});
