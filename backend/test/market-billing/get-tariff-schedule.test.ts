/**
 * Module 4 — get-tariff-schedule handler tests
 *
 * Deep assertions on RLS activation order inside a transaction:
 *   1st query = BEGIN
 *   2nd query = SET LOCAL app.current_org_id
 *   3rd query = SELECT * FROM tariff_schedules
 *   4th query = COMMIT
 *
 * Covers: happy path, 401 on missing auth, 403 on bad role,
 *         finally-release on error, ROLLBACK on failure.
 */

// ---------------------------------------------------------------------------
// Mock pg BEFORE importing handler
// ---------------------------------------------------------------------------

const mockRelease = jest.fn();
const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
    })),
  };
});

// Set env before import
process.env.DATABASE_URL = 'postgres://localhost:5432/vpp_test';

import { handler } from '../../src/market-billing/handlers/get-tariff-schedule';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.signature`;
}

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    headers: {},
    body: undefined,
    routeKey: 'GET /tariff-schedules',
    rawPath: '/tariff-schedules',
    rawQueryString: '',
    version: '2.0',
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/tariff-schedules',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /tariff-schedules',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    ...overrides,
  } as APIGatewayProxyEventV2;
}

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

function validAuthHeader(): Record<string, string> {
  return {
    authorization: `Bearer ${makeJwt({
      userId: 'user-1',
      orgId: ORG_ID,
      role: 'ORG_MANAGER',
    })}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get-tariff-schedule handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Test 1: Happy path — full transaction lifecycle ─────────────────────
  it('BEGIN → SET LOCAL → SELECT → COMMIT → returns schedules', async () => {
    const fakeRows = [
      { schedule_id: 's1', tariff_type: 'branca', peak_rate: 1.5 },
      { schedule_id: 's2', tariff_type: 'convencional', peak_rate: 0.8 },
    ];

    // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // SET LOCAL
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // SELECT
    mockQuery.mockResolvedValueOnce({ rows: fakeRows, rowCount: 2 });
    // COMMIT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const event = makeEvent({ headers: validAuthHeader() });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.data.schedules).toEqual(fakeRows);
    expect(body.data._tenant).toEqual({ orgId: ORG_ID, role: 'ORG_MANAGER' });

    // ── Deep assertion: query call order ─────────────────────────────
    expect(mockQuery).toHaveBeenCalledTimes(4);

    // 1st: BEGIN transaction
    expect(mockQuery.mock.calls[0][0]).toBe('BEGIN');

    // 2nd: RLS shield activation
    expect(mockQuery.mock.calls[1][0]).toBe('SET LOCAL app.current_org_id = $1');
    expect(mockQuery.mock.calls[1][1]).toEqual([ORG_ID]);

    // 3rd: data fetch
    expect(mockQuery.mock.calls[2][0]).toContain('SELECT * FROM tariff_schedules');

    // 4th: COMMIT
    expect(mockQuery.mock.calls[3][0]).toBe('COMMIT');

    // client.release() was called exactly once
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: Missing Authorization → 401, no DB interaction ─────────────
  it('returns 401 when Authorization header is missing', async () => {
    const event = makeEvent({ headers: {} });
    const result = await handler(event);

    expect(result.statusCode).toBe(401);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);

    // No DB interaction at all
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  // ── Test 3: client.release() + ROLLBACK on SELECT error ────────────────
  it('calls ROLLBACK and client.release() when SELECT throws', async () => {
    // BEGIN succeeds
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // SET LOCAL succeeds
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // SELECT throws
    mockQuery.mockRejectedValueOnce(new Error('connection reset'));
    // ROLLBACK succeeds (called in catch block)
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const event = makeEvent({ headers: validAuthHeader() });
    const result = await handler(event);

    // Handler catches error and returns 500
    expect(result.statusCode).toBe(500);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Internal server error');

    // ── Deep assertion: ROLLBACK was issued, then release ────────────
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[3][0]).toBe('ROLLBACK');
    expect(mockRelease).toHaveBeenCalledTimes(1);

    // SET LOCAL was still attempted correctly
    expect(mockQuery.mock.calls[1][0]).toBe('SET LOCAL app.current_org_id = $1');
  });

  // ── Test 4: Invalid JWT (no orgId) → 401 ──────────────────────────────
  it('returns 401 when JWT has no orgId', async () => {
    const event = makeEvent({
      headers: { authorization: `Bearer ${makeJwt({ sub: 'user123' })}` },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── Test 5: pool.connect() failure returns 500, no release ─────────────
  it('returns 500 when pool.connect() fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('pool exhausted'));

    const event = makeEvent({ headers: validAuthHeader() });
    const result = await handler(event);

    expect(result.statusCode).toBe(500);

    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Internal server error');

    // No query or release should have been called
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
