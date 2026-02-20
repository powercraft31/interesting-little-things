import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok } from '../../shared/types/api';

/**
 * GET /revenue-trend
 * Returns 7-day revenue/cost/profit trend arrays.
 * Field names match the frontend INITIAL_DATA.revenueTrend shape exactly.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const revenueTrend = {
    receita: [42150, 38900, 45200, 48235, 51000, 39800, 41500],
    custo: [9800, 8700, 10200, 10850, 11500, 9200, 9600],
    lucro: [32350, 30200, 35000, 37385, 39500, 30600, 31900],
  };

  const body = ok(revenueTrend);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
