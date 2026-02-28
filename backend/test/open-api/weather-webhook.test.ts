import { getPool, closePool } from '../../src/shared/db';
import type { Request, Response } from 'express';
import { handleWeatherWebhook } from '../../src/open-api/handlers/weather-webhook';
import { Pool } from 'pg';

process.env.WEBHOOK_SECRET = 'test-secret-2026';

function makeReq(body: unknown, secret?: string): Partial<Request> {
  return {
    headers: secret ? { 'x-webhook-secret': secret } : {},
    body,
  };
}
function makeRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('weather-webhook handler (M7 inbound)', () => {
  let pool: Pool;

  const testForecastTime = '2099-12-31T17:00:00Z'; // won't conflict with real data
  const testPayload = {
    location: 'TEST_LOC',
    forecast_time: testForecastTime,
    temperature_c: 31.5,
    irradiance_w_m2: 620.0,
    cloud_cover_pct: 15.0,
    source: 'test',
  };

  beforeAll(() => {
    pool = getPool();
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM weather_cache WHERE location = 'TEST_LOC'`
    );
    await closePool();
  });

  it('should return 401 when secret is missing', async () => {
    const res = makeRes();
    await handleWeatherWebhook(makeReq(testPayload) as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should write to weather_cache and return 200 with valid payload', async () => {
    const res = makeRes();
    await handleWeatherWebhook(makeReq(testPayload, 'test-secret-2026') as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(200);

    const result = await pool.query(
      `SELECT temperature, irradiance FROM weather_cache
       WHERE location = 'TEST_LOC' AND recorded_at = $1`,
      [new Date(testForecastTime)]
    );
    expect(result.rows).toHaveLength(1);
    expect(parseFloat(result.rows[0].temperature)).toBe(31.5);
  });

  it('should overwrite on duplicate push (UPSERT idempotency)', async () => {
    const updated = { ...testPayload, temperature_c: 35.0 };
    const res = makeRes();
    await handleWeatherWebhook(makeReq(updated, 'test-secret-2026') as Request, res as Response);

    const result = await pool.query(
      `SELECT temperature FROM weather_cache WHERE location = 'TEST_LOC'`
    );
    expect(parseFloat(result.rows[0].temperature)).toBe(35.0);
  });
});
