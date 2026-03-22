/**
 * Seed script for P5 Strategy Triggers test data.
 *
 * Usage:
 *   npx ts-node scripts/seed-p5.ts
 *
 * Prerequisites: migration 001_p5_strategy_triggers.sql must be applied first.
 */

import { getServicePool, closeAllPools } from "../src/shared/db";

// Use first available org, or create SOLFACIL if none exist
let ORG_ID = "SOLFACIL";

async function seed() {
  const pool = getServicePool();

  // Resolve org_id — use existing org or create SOLFACIL
  const orgResult = await pool.query(
    `SELECT org_id FROM organizations LIMIT 1`,
  );
  if (orgResult.rows.length > 0) {
    ORG_ID = orgResult.rows[0].org_id;
    console.log(`[seed-p5] Using existing org: ${ORG_ID}`);
  } else {
    await pool.query(
      `INSERT INTO organizations (org_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ORG_ID, "Solfacil Platform"],
    );
    console.log(`[seed-p5] Created org: ${ORG_ID}`);
  }

  // Look up real gateway_ids from seed data
  const gwResult = await pool.query(
    `SELECT gateway_id FROM gateways WHERE org_id = $1 LIMIT 4`,
    [ORG_ID],
  );
  const gatewayIds: string[] = gwResult.rows.map(
    (r: { gateway_id: string }) => r.gateway_id,
  );

  // Fallback placeholder SNs if no gateways exist yet
  if (gatewayIds.length === 0) {
    gatewayIds.push(
      "WKRD24070202100144F",
      "WKRD24070202100145G",
      "WKRD24070202100146H",
    );
  }

  const scopeAll = JSON.stringify(gatewayIds);
  const scopeFirst = JSON.stringify(gatewayIds.slice(0, 1));
  const scopeTwo = JSON.stringify(gatewayIds.slice(0, 2));

  // Clean previous seed data
  await pool.query(`DELETE FROM posture_overrides WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM strategy_intents WHERE org_id = $1`, [ORG_ID]);

  // ── Strategy Intents ────────────────────────────────────────────────

  // 1. Peak shaving — active, approval_required, immediate
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary, constraints,
      suggested_playbook, actor, expires_at
    ) VALUES (
      $1, 'peak_shaving', 'active', 'approval_required', 'immediate',
      'Peak demand risk detected',
      'Grid power approaching contracted demand limit on 2 gateways. 15-min rolling avg at 92% of threshold.',
      $2, $3, '2 gateways near peak threshold',
      '{"reserve_floor_pct": 20, "confidence": 0.87, "freshness_sec": 45}',
      'Dispatch peak shaving schedule to affected gateways',
      'platform',
      NOW() + INTERVAL '2 hours'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        grid_power_avg_kw: 4.6,
        contracted_demand_kw: 5.0,
        threshold_pct: 92,
        soc_levels: { [gatewayIds[0]]: 65, [gatewayIds[1]]: 58 },
        captured_at: new Date().toISOString(),
      }),
      scopeTwo,
    ],
  );

  // 2. Tariff arbitrage — approved, approval_required, soon
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary,
      suggested_playbook, actor, decided_at, expires_at
    ) VALUES (
      $1, 'tariff_arbitrage', 'approved', 'approval_required', 'soon',
      'Off-peak charging opportunity',
      'Current tariff is off-peak (R$0.35/kWh). SoC at 42% avg across fleet. Charge window optimal.',
      $2, $3, 'All gateways — fleet-wide',
      'Charge batteries during off-peak window',
      'operator:admin', NOW() - INTERVAL '10 minutes',
      NOW() + INTERVAL '4 hours'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        current_tariff_rate: 0.35,
        peak_tariff_rate: 0.89,
        avg_soc_pct: 42,
        charge_window: { start: "22:00", end: "06:00" },
        captured_at: new Date().toISOString(),
      }),
      scopeAll,
    ],
  );

  // 3. Reserve protection — active, auto_governed, immediate
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary, constraints,
      suggested_playbook, actor, expires_at
    ) VALUES (
      $1, 'reserve_protection', 'active', 'auto_governed', 'immediate',
      'Low battery reserve — protective action',
      'Gateway SoC dropped below min_soc threshold (20%). Auto-governance activating reserve protection.',
      $2, $3, '1 gateway below reserve floor',
      '{"reserve_floor_pct": 20, "emergency_soc_pct": 10, "confidence": 0.95}',
      'Halt discharge, enable priority charging',
      'platform',
      NOW() + INTERVAL '1 hour'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        soc_pct: 18,
        min_soc: 20,
        emergency_soc: 10,
        battery_power_kw: -1.2,
        captured_at: new Date().toISOString(),
      }),
      scopeFirst,
    ],
  );

  // 4. Curtailment mitigation — active, observe, watch
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary,
      actor, expires_at
    ) VALUES (
      $1, 'curtailment_mitigation', 'active', 'observe', 'watch',
      'PV curtailment risk forming',
      'PV generation exceeding load + battery capacity on 1 gateway. Export not permitted.',
      $2, $3, '1 gateway with curtailment risk',
      'platform',
      NOW() + INTERVAL '3 hours'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        pv_power_kw: 4.8,
        load_power_kw: 1.2,
        battery_power_kw: 2.5,
        max_charge_kw: 3.0,
        allow_export: false,
        captured_at: new Date().toISOString(),
      }),
      scopeFirst,
    ],
  );

  // 5. Peak shaving — deferred, for testing deferred status
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary,
      actor, decided_at, expires_at
    ) VALUES (
      $1, 'peak_shaving', 'deferred', 'approval_required', 'soon',
      'Peak risk deferred by operator',
      'Operator deferred: expecting demand to decrease after shift change.',
      $2, $3, 'All gateways',
      'operator:admin', NOW() - INTERVAL '30 minutes',
      NOW() + INTERVAL '1 hour'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        grid_power_avg_kw: 4.2,
        contracted_demand_kw: 5.0,
        threshold_pct: 84,
        captured_at: new Date().toISOString(),
      }),
      scopeAll,
    ],
  );

  // 6. Reserve protection — expired, for testing expiry
  await pool.query(
    `INSERT INTO strategy_intents (
      org_id, family, status, governance_mode, urgency,
      title, reason_summary, evidence_snapshot,
      scope_gateway_ids, scope_summary,
      actor, decided_at, expires_at
    ) VALUES (
      $1, 'reserve_protection', 'expired', 'auto_governed', 'immediate',
      'Reserve protection — resolved',
      'SoC recovered above min_soc after protective charging. Intent expired.',
      $2, $3, '1 gateway (recovered)',
      'platform', NOW() - INTERVAL '2 hours',
      NOW() - INTERVAL '1 hour'
    )`,
    [
      ORG_ID,
      JSON.stringify({
        soc_pct: 45,
        min_soc: 20,
        captured_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      }),
      scopeFirst,
    ],
  );

  // ── Posture Overrides ─────────────────────────────────────────────────

  // 1. Active override — force_protective, expires in 2 hours
  await pool.query(
    `INSERT INTO posture_overrides (
      org_id, override_type, reason, scope_gateway_ids,
      actor, starts_at, expires_at
    ) VALUES (
      $1, 'force_protective',
      'Maintenance window: forcing protective mode while firmware update runs on gateway fleet.',
      $2,
      'operator:admin',
      NOW(),
      NOW() + INTERVAL '2 hours'
    )`,
    [ORG_ID, scopeAll],
  );

  // 2. Expired override — for testing expiry logic
  await pool.query(
    `INSERT INTO posture_overrides (
      org_id, override_type, reason, scope_gateway_ids,
      actor, starts_at, expires_at
    ) VALUES (
      $1, 'suppress_economic',
      'Grid instability reported by utility. Suppressing economic strategies as precaution.',
      $2,
      'operator:admin',
      NOW() - INTERVAL '4 hours',
      NOW() - INTERVAL '2 hours'
    )`,
    [ORG_ID, scopeAll],
  );

  console.log("[seed-p5] Seed data inserted successfully.");
}

seed()
  .catch((err) => {
    console.error("[seed-p5] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
