import { handler } from '../../src/iot-hub/handlers/ingest-telemetry';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ingest-telemetry handler', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a valid telemetry event without throwing', async () => {
    const event = {
      device_id: 'DEV_001',
      asset_type: 'battery',
      soc: 72.5,
      power_kw: 4.8,
      temperature_c: 28.3,
      timestamp: '2026-02-20T10:00:00Z',
    };

    await expect(handler(event)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      'ingest-telemetry received:',
      JSON.stringify(event),
    );
  });

  it('accepts an empty event without throwing', async () => {
    await expect(handler({})).resolves.toBeUndefined();
  });

  it('accepts an event with missing optional fields', async () => {
    const event = {
      device_id: 'DEV_002',
    };

    await expect(handler(event)).resolves.toBeUndefined();
  });

  it('handles null/undefined event gracefully', async () => {
    await expect(handler(null)).resolves.toBeUndefined();
    await expect(handler(undefined)).resolves.toBeUndefined();
  });
});
