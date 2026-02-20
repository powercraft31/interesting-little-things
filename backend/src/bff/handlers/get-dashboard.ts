import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok } from '../../shared/types/api';

/**
 * GET /dashboard
 * Returns aggregated KPIs for the VPP dashboard:
 * - Algorithm KPIs (alpha, mape, selfConsumption)
 * - Revenue breakdown (doughnut chart data)
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const baseAlpha = 76.3;
  const deltaAlpha = parseFloat(((Math.random() - 0.5) * 2).toFixed(1));

  const baseMape = 18.5;
  const deltaMape = parseFloat(((Math.random() - 0.5) * 1).toFixed(1));

  const baseSelfCon = 98.2;
  const deltaSelfCon = parseFloat(((Math.random() - 0.5) * 0.5).toFixed(1));

  const body = ok({
    alpha: {
      value: (baseAlpha + deltaAlpha).toFixed(1),
      delta: deltaAlpha.toFixed(1),
    },
    mape: {
      value: (baseMape + deltaMape).toFixed(1),
      delta: (-deltaMape).toFixed(1),
    },
    selfConsumption: {
      value: (baseSelfCon + deltaSelfCon).toFixed(1),
      delta: deltaSelfCon.toFixed(1),
    },
    revenueBreakdown: {
      values: [32450, 12385, 3400],
      colors: ['#3730a3', '#059669', '#d97706'],
    },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
