import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok } from '../../shared/types/api';
import { Role } from '../../shared/types/auth';
import { extractTenantContext, requireRole, apiError } from '../middleware/tenant-context';

/**
 * GET /trades
 * Returns today's trade schedule.
 * Field names match the frontend INITIAL_DATA.trades shape exactly.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [Role.SOLFACIL_ADMIN, Role.ORG_MANAGER, Role.ORG_OPERATOR, Role.ORG_VIEWER]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? 'Error');
  }

  const trades = [
    {
      time: '00:00 - 06:00',
      tarifa: 'off_peak',
      operacao: 'buy',
      preco: 'R$ 0,25/kWh',
      volume: '15,6',
      resultado: '-R$ 3.900',
      status: 'executed',
    },
    {
      time: '06:00 - 09:00',
      tarifa: 'intermediate',
      operacao: 'hold',
      preco: 'R$ 0,45/kWh',
      volume: '\u2014',
      resultado: 'R$ 0',
      status: 'executed',
    },
    {
      time: '09:00 - 12:00',
      tarifa: 'intermediate',
      operacao: 'partial_sell',
      preco: 'R$ 0,52/kWh',
      volume: '8,2',
      resultado: '+R$ 4.264',
      status: 'executed',
    },
    {
      time: '12:00 - 15:00',
      tarifa: 'intermediate',
      operacao: 'hold',
      preco: 'R$ 0,48/kWh',
      volume: '\u2014',
      resultado: 'R$ 0',
      status: 'executed',
    },
    {
      time: '15:00 - 17:00',
      tarifa: 'intermediate',
      operacao: 'partial_sell',
      preco: 'R$ 0,55/kWh',
      volume: '6,8',
      resultado: '+R$ 3.740',
      status: 'executed',
    },
    {
      time: '17:00 - 20:00',
      tarifa: 'peak',
      operacao: 'total_sell',
      preco: 'R$ 0,82/kWh',
      volume: '23,6',
      resultado: '+R$ 19.352',
      status: 'executing',
    },
    {
      time: '20:00 - 22:00',
      tarifa: 'intermediate',
      operacao: 'buy',
      preco: 'R$ 0,42/kWh',
      volume: '10,8',
      resultado: '-R$ 4.536',
      status: 'scheduled',
    },
    {
      time: '22:00 - 00:00',
      tarifa: 'off_peak',
      operacao: 'buy',
      preco: 'R$ 0,25/kWh',
      volume: '20,8',
      resultado: '-R$ 5.200',
      status: 'scheduled',
    },
  ];

  const body = ok({ trades, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
