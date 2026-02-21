import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { ok } from '../../shared/types/api';
import { Role } from '../../shared/types/auth';
import { extractTenantContext, requireRole, apiError } from '../middleware/tenant-context';

// ---------------------------------------------------------------------------
// AppConfig — Feature Flags
// ---------------------------------------------------------------------------

const APPCONFIG_BASE = process.env.APPCONFIG_BASE_URL ?? 'http://localhost:2772';
const APPCONFIG_APP  = process.env.APPCONFIG_APP    ?? 'solfacil-vpp-dev';
const APPCONFIG_ENV  = process.env.APPCONFIG_ENV    ?? 'dev';

interface FeatureFlags {
  readonly [flagName: string]: {
    readonly isEnabled: boolean;
    readonly targetOrgIds?: string[];
  };
}

const DEFAULT_FLAGS: FeatureFlags = {};

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/feature-flags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return DEFAULT_FLAGS;
    return await res.json() as FeatureFlags;
  } catch {
    return DEFAULT_FLAGS;
  }
}

function isFlagEnabled(flags: FeatureFlags, flagName: string, orgId: string): boolean {
  const flag = flags[flagName];
  if (!flag || !flag.isEnabled) return false;
  if (!flag.targetOrgIds || flag.targetOrgIds.length === 0) return true;
  return flag.targetOrgIds.includes(orgId);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * GET /assets
 * Returns VPP asset portfolio with mode & financial metrics.
 * Field names match the frontend INITIAL_DATA.assets shape exactly.
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

  const traceId = `vpp-${randomUUID()}`;
  const flags = await fetchFeatureFlags();
  const showRoiMetrics = isFlagEnabled(flags, 'show-roi-metrics', ctx.orgId);

  const ALL_ASSETS = [
    {
      id: 'ASSET_SP_001',
      orgId: 'ORG_ENERGIA_001',
      name: 'São Paulo - Casa Verde',
      region: 'SP',
      status: 'operando',
      investimento: 4200000,
      capacidade: 5.2,
      unidades: 948,
      socMedio: 65,
      receitaHoje: 18650,
      receitaMes: 412300,
      roi: 19.2,
      custoHoje: 4250,
      lucroHoje: 14400,
      payback: '3,8',
      operationMode: 'peak_valley_arbitrage',
    },
    {
      id: 'ASSET_RJ_002',
      orgId: 'ORG_ENERGIA_001',
      name: 'Rio de Janeiro - Copacabana',
      region: 'RJ',
      status: 'operando',
      investimento: 3800000,
      capacidade: 4.8,
      unidades: 872,
      socMedio: 72,
      receitaHoje: 16420,
      receitaMes: 378500,
      roi: 17.8,
      custoHoje: 3890,
      lucroHoje: 12530,
      payback: '4,1',
      operationMode: 'self_consumption',
    },
    {
      id: 'ASSET_MG_003',
      orgId: 'ORG_SOLARBR_002',
      name: 'Belo Horizonte - Pampulha',
      region: 'MG',
      status: 'operando',
      investimento: 2900000,
      capacidade: 3.6,
      unidades: 654,
      socMedio: 58,
      receitaHoje: 11280,
      receitaMes: 298400,
      roi: 16.4,
      custoHoje: 2680,
      lucroHoje: 8600,
      payback: '4,5',
      operationMode: 'peak_valley_arbitrage',
    },
    {
      id: 'ASSET_PR_004',
      orgId: 'ORG_SOLARBR_002',
      name: 'Curitiba - Batel',
      region: 'PR',
      status: 'carregando',
      investimento: 1500000,
      capacidade: 2.0,
      unidades: 373,
      socMedio: 34,
      receitaHoje: 6100,
      receitaMes: 145800,
      roi: 15.1,
      custoHoje: 1895,
      lucroHoje: 4205,
      payback: '4,8',
      operationMode: 'peak_shaving',
    },
  ];

  // Data isolation: SOLFACIL_ADMIN sees all orgs; others filtered by their orgId
  const filtered = ctx.role === Role.SOLFACIL_ADMIN
    ? ALL_ASSETS
    : ALL_ASSETS.filter(a => a.orgId === ctx.orgId);

  // Apply feature flag: conditionally include ROI metrics
  const assets = filtered.map(a => ({
    ...a,
    roi: showRoiMetrics ? a.roi : undefined,
    payback: showRoiMetrics ? a.payback : undefined,
  }));

  const body = ok({ assets, _tenant: { orgId: ctx.orgId, role: ctx.role } });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'x-trace-id': traceId },
    body: JSON.stringify(body),
  };
}
