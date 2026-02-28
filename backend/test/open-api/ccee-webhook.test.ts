import { getPool, closePool } from '../../src/shared/db';
import type { Request, Response } from 'express';
import { handleCceeWebhook } from '../../src/open-api/handlers/ccee-webhook';
import { Pool } from 'pg';

// Fix WEBHOOK_SECRET to test value
process.env.WEBHOOK_SECRET = 'test-secret-2026';

// helper: mock req/res
function makeReq(body: unknown, secret?: string): Partial<Request> {
  return {
    headers: secret ? { 'x-webhook-secret': secret } : {},
    body,
  };
}
function makeRes(): { status: jest.Mock; json: jest.Mock; _status: number; _body: unknown } {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('ccee-webhook handler (M7 inbound)', () => {
  let pool: Pool;

  const testPayload = {
    mes_referencia: 202699,  // fake month that won't conflict with real data
    dia: 1,
    hora: 17,
    submercado: 'SUDESTE' as const,
    price_brl_mwh: 450.00,
  };

  beforeAll(() => {
    pool = getPool();
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM pld_horario WHERE mes_referencia = 202699`
    );
    await closePool();
  });

  it('should return 401 when secret is missing', async () => {
    const req = makeReq(testPayload);  // no secret
    const res = makeRes();
    await handleCceeWebhook(req as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 when secret is wrong', async () => {
    const req = makeReq(testPayload, 'wrong-secret');
    const res = makeRes();
    await handleCceeWebhook(req as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should write to pld_horario and return 200 with valid payload', async () => {
    const req = makeReq(testPayload, 'test-secret-2026');
    const res = makeRes();
    await handleCceeWebhook(req as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);

    // Verify actual DB write
    const result = await pool.query(
      `SELECT pld_hora FROM pld_horario
       WHERE mes_referencia = $1 AND dia = $2 AND hora = $3 AND submercado = $4`,
      [202699, 1, 17, 'SUDESTE']
    );
    expect(result.rows).toHaveLength(1);
    expect(parseFloat(result.rows[0].pld_hora)).toBe(450.00);
  });

  it('should overwrite on duplicate push (UPSERT idempotency)', async () => {
    const updated = { ...testPayload, price_brl_mwh: 510.00 };
    const req = makeReq(updated, 'test-secret-2026');
    const res = makeRes();
    await handleCceeWebhook(req as Request, res as unknown as Response);

    const result = await pool.query(
      `SELECT pld_hora FROM pld_horario
       WHERE mes_referencia = 202699 AND dia = 1 AND hora = 17 AND submercado = 'SUDESTE'`
    );
    expect(result.rows).toHaveLength(1);
    expect(parseFloat(result.rows[0].pld_hora)).toBe(510.00);
  });
});
