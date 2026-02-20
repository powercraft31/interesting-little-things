import type { Handler } from 'aws-lambda';
import { ok } from '../../shared/types/api';

/**
 * Market & Billing — Get Tariff Schedule
 * Queries current Tarifa Branca rates.
 * Phase 1: stub data only — no RDS connection.
 */
export const handler: Handler = async () => {
  const body = ok({
    message: 'Tariff schedule endpoint — stub',
    stage: process.env.STAGE,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
