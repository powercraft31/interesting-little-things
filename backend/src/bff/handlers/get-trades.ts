import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok } from '../../shared/types/api';
import { Role } from '../../shared/types/auth';
import { extractTenantContext, requireRole, apiError } from '../middleware/tenant-context';
import { queryWithOrg } from '../../shared/db';

/**
 * GET /trades
 * v5.5: 從 trade_schedules 表查詢今日交易計劃。
 * 保持舊 field names（time/operacao/volume/status/preco）讓前端相容，
 * 同時新增批發市場視角欄位（assetId/assetName/action/targetPldPrice）。
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

  const { rows } = await queryWithOrg(
    `SELECT
       ts.id,
       ts.asset_id,
       ts.action,
       ts.planned_time,
       ts.expected_volume_kwh,
       ts.target_pld_price,
       a.name AS asset_name
     FROM trade_schedules ts
     JOIN assets a ON ts.asset_id = a.asset_id
     WHERE ts.planned_time >= NOW() - INTERVAL '1 hour'
     ORDER BY ts.planned_time ASC
     LIMIT 20`,
    [],
    ctx.role === Role.SOLFACIL_ADMIN ? null : ctx.orgId,
  );

  const trades = rows.map(row => ({
    // 舊有 field names（前端依賴）
    time: new Date(row.planned_time as string).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }),
    operacao: row.action === 'charge' ? 'buy' : row.action === 'discharge' ? 'sell' : 'hold',
    volume: parseFloat(String(row.expected_volume_kwh)).toFixed(1),
    status: new Date(row.planned_time as string) < new Date() ? 'executed' : 'scheduled',
    // 新增 v5.5 欄位（批發市場視角）
    assetId: row.asset_id,
    assetName: row.asset_name,
    action: row.action,
    targetPldPrice: row.target_pld_price,
    preco: row.target_pld_price
      ? `R$ ${parseFloat(String(row.target_pld_price)).toFixed(0)}/MWh`
      : '\u2014',
  }));

  const body = ok({ trades, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
