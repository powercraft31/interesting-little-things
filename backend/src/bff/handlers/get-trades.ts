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

  const trades = rows.map(row => {
    const plannedTime = new Date(row.planned_time as string);
    const hour = plannedTime.getHours();
    const isPeak = hour >= 17 && hour < 20;
    const isOffPeak = (hour >= 0 && hour < 6) || hour >= 22;
    const tarifa = isPeak ? 'peak' : isOffPeak ? 'off_peak' : 'intermediate';

    const volKwh = parseFloat(String(row.expected_volume_kwh));
    const pld = row.target_pld_price ? parseFloat(String(row.target_pld_price)) : 0;
    const resultReais = (pld / 1000) * volKwh; // R$/MWh ÷ 1000 × kWh = R$
    const isSell = row.action === 'discharge';
    const resultFormatted = pld > 0
      ? (isSell ? '+' : '-') + 'R$ ' + Math.round(isSell ? resultReais : resultReais).toLocaleString('pt-BR')
      : 'R$ 0';

    return {
      // 舊有 field names（前端依賴，必須保留）
      time: plannedTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
      }),
      tarifa,                                                           // ← 補上：前端渲染必需
      operacao: row.action === 'charge' ? 'buy' : row.action === 'discharge' ? 'sell' : 'hold',
      preco: pld > 0 ? `R$ ${pld.toFixed(0)}/MWh` : '\u2014',
      volume: volKwh.toFixed(1),
      resultado: resultFormatted,                                       // ← 補上：前端結果欄
      status: plannedTime < new Date() ? 'executed' : 'scheduled',
      // v5.5 新增（批發市場視角）
      assetId: row.asset_id,
      assetName: row.asset_name,
      action: row.action,
      targetPldPrice: row.target_pld_price,
    };
  });

  const body = ok({ trades, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
