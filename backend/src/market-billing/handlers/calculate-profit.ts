import type { Handler } from 'aws-lambda';
import { ok } from '../../shared/types/api';

/**
 * Market & Billing — Calculate Profit
 * Computes revenue/cost/profit per asset per day.
 * Phase 1: stub data only — no RDS connection.
 */
export const handler: Handler = async () => {
  const body = ok({
    message: 'Calculate profit endpoint — stub',
    stage: process.env.STAGE,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
