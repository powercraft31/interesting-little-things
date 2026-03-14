#!/usr/bin/env python3
"""
Demo Data Hydration Script
Populates 11 downstream pipeline tables from existing telemetry_history data.
Idempotent: safe to run multiple times (deletes existing demo data first).
Wraps everything in a single transaction.
"""

import random
import sys
from datetime import date, datetime, timedelta, timezone

import psycopg2

# ── Constants ──────────────────────────────────────────────────────────────────

DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "dbname": "solfacil_vpp",
    "user": "postgres",
    "password": "postgres_admin_2026",
}

ORG_ID = "ORG_DEMO_001"
DATE_START = date(2025, 12, 13)
DATE_END = date(2026, 3, 12)  # inclusive last day
NUM_DAYS = 90  # Dec 13 → Mar 12 inclusive

DEMO_ASSETS = [
    "DEMO-GW-5KW-INV", "DEMO-GW-5KW-PV", "DEMO-GW-5KW-METER",
    "DEMO-GW-10KW-INV", "DEMO-GW-10KW-PV", "DEMO-GW-10KW-METER",
    "DEMO-GW-50KW-INV", "DEMO-GW-50KW-PV", "DEMO-GW-50KW-METER",
    "DEMO-GW-50KW-HVAC",
]

OFFLINE_CAUSES = [
    "network_timeout", "gateway_restart", "inverter_fault", "firmware_update"
]

DISPATCH_ERRORS = [
    "timeout", "inverter_comm_error", "soc_below_minimum", "grid_fault_detected"
]

COMMAND_ERRORS = [
    "timeout", "inverter_offline", "soc_below_minimum", "grid_fault"
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def date_range(start: date, end_inclusive: date):
    """Yield dates from start to end_inclusive."""
    current = start
    while current <= end_inclusive:
        yield current
        current += timedelta(days=1)


def generate_pld_price(hour: int, day_seed: int) -> float:
    """Generate realistic Brazilian PLD spot price in R$/MWh."""
    rng = random.Random(day_seed * 100 + hour)
    if 18 <= hour < 21:
        base, noise = 300.0, 50.0
    elif hour >= 22 or hour < 6:
        base, noise = 100.0, 20.0
    else:
        base, noise = 155.0, 25.0
    return round(base + rng.uniform(-noise, noise), 2)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("DEMO DATA HYDRATION")
    print("=" * 60)

    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # ── Preflight check ────────────────────────────────────────
        cur.execute(
            "SELECT COUNT(*) FROM telemetry_history WHERE asset_id LIKE 'DEMO-%%'"
        )
        telem_count = cur.fetchone()[0]
        if telem_count == 0:
            print("ERROR: No demo telemetry found. Run demo seed first.")
            sys.exit(1)
        print(f"Telemetry rows found: {telem_count}")

        # ── Phase 0a: Create missing partitions ────────────────────
        print("\n── Phase 0a: Partitions ──")
        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename LIKE 'asset_5min_metrics_202%%'
        """)
        existing_partitions = {row[0] for row in cur.fetchall()}

        partitions_created = 0
        # Need partitions from DATE_START through DATE_END (inclusive)
        # Existing ones cover 2026-03-06 onward
        partition_end = date(2026, 3, 13)  # exclusive upper bound for partition loop
        for d in date_range(DATE_START, partition_end - timedelta(days=1)):
            name = f"asset_5min_metrics_{d.strftime('%Y%m%d')}"
            if name not in existing_partitions:
                next_d = d + timedelta(days=1)
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {name}
                        PARTITION OF asset_5min_metrics
                        FOR VALUES FROM ('{d.isoformat()} 03:00:00+00')
                                     TO ('{next_d.isoformat()} 03:00:00+00')
                """)
                partitions_created += 1
        print(f"  Partitions created: {partitions_created}")

        # ── Phase 0b: Tariff schedule lookup ───────────────────────
        print("\n── Phase 0b: Tariff schedule ──")
        cur.execute(
            "SELECT id FROM tariff_schedules WHERE org_id = %s LIMIT 1",
            (ORG_ID,)
        )
        row = cur.fetchone()
        if row:
            tariff_id = row[0]
            print(f"  Using existing tariff_schedule id={tariff_id}")
        else:
            cur.execute("""
                INSERT INTO tariff_schedules (
                    org_id, schedule_name,
                    peak_start, peak_end, peak_rate, offpeak_rate,
                    feed_in_rate, intermediate_rate,
                    intermediate_start, intermediate_end,
                    disco, currency, effective_from, billing_power_factor
                ) VALUES (
                    %s, 'Enel SP Residencial TOU',
                    '18:00:00', '20:59:00', 0.9500, 0.5500,
                    0.2500, 0.7200,
                    '17:00:00', '21:59:00',
                    'Enel SP', 'BRL', '2025-01-01', 0.92
                ) RETURNING id
            """, (ORG_ID,))
            tariff_id = cur.fetchone()[0]
            print(f"  Created tariff_schedule id={tariff_id}")

        # ══════════════════════════════════════════════════════════
        # PHASE 1: Tier 1 tables
        # ══════════════════════════════════════════════════════════
        print("\n── Phase 1a: asset_5min_metrics ──")
        cur.execute("DELETE FROM asset_5min_metrics WHERE asset_id LIKE 'DEMO-%%'")
        deleted = cur.rowcount
        cur.execute("""
            INSERT INTO asset_5min_metrics (
                asset_id, window_start,
                pv_energy_kwh, bat_charge_kwh, bat_discharge_kwh,
                grid_import_kwh, grid_export_kwh, load_kwh,
                bat_charge_from_grid_kwh, avg_battery_soc, data_points
            )
            SELECT
                asset_id,
                recorded_at AS window_start,
                ROUND(COALESCE(pv_power, 0) / 12.0, 4),
                ROUND(GREATEST(0, COALESCE(battery_power, 0)) / 12.0, 4),
                ROUND(GREATEST(0, -COALESCE(battery_power, 0)) / 12.0, 4),
                ROUND(COALESCE(grid_import_kwh, 0), 4),
                ROUND(COALESCE(grid_export_kwh, 0), 4),
                ROUND(COALESCE(load_power, 0) / 12.0, 4),
                ROUND(GREATEST(0,
                    GREATEST(0, COALESCE(battery_power, 0)) / 12.0
                    - COALESCE(pv_power, 0) / 12.0
                ), 4),
                battery_soc,
                1
            FROM telemetry_history
            WHERE asset_id LIKE 'DEMO-%%'
        """)
        inserted = cur.rowcount
        print(f"  Deleted {deleted}, inserted {inserted}")

        print("\n── Phase 1b: asset_hourly_metrics ──")
        cur.execute("DELETE FROM asset_hourly_metrics WHERE asset_id LIKE 'DEMO-%%'")
        deleted = cur.rowcount
        cur.execute("""
            INSERT INTO asset_hourly_metrics (
                asset_id, hour_timestamp,
                total_charge_kwh, total_discharge_kwh,
                data_points_count,
                avg_battery_soh, avg_battery_voltage, avg_battery_temperature
            )
            SELECT
                asset_id,
                date_trunc('hour', recorded_at) AS hour_timestamp,
                ROUND(SUM(GREATEST(0, COALESCE(battery_power, 0)) / 12.0)::numeric, 4),
                ROUND(SUM(GREATEST(0, -COALESCE(battery_power, 0)) / 12.0)::numeric, 4),
                COUNT(*),
                ROUND(AVG(battery_soh)::numeric, 1),
                ROUND(AVG(battery_voltage)::numeric, 1),
                ROUND(AVG(battery_temperature)::numeric, 1)
            FROM telemetry_history
            WHERE asset_id LIKE 'DEMO-%%'
            GROUP BY asset_id, date_trunc('hour', recorded_at)
        """)
        inserted = cur.rowcount
        print(f"  Deleted {deleted}, inserted {inserted}")

        print("\n── Phase 1c: daily_uptime_snapshots ──")
        cur.execute(
            "DELETE FROM daily_uptime_snapshots WHERE org_id = %s", (ORG_ID,)
        )
        deleted = cur.rowcount

        rng_uptime = random.Random(42)
        downtime_days = []
        uptime_rows = []
        for d in date_range(DATE_START, DATE_END):
            if rng_uptime.random() < 0.15:
                online = 9
                downtime_days.append(d)
            else:
                online = 10
            uptime_pct = online / 10.0 * 100
            uptime_rows.append((ORG_ID, d, 10, online, uptime_pct))

        cur.executemany(
            """INSERT INTO daily_uptime_snapshots
               (org_id, date, total_assets, online_assets, uptime_pct)
               VALUES (%s, %s, %s, %s, %s)""",
            uptime_rows,
        )
        print(f"  Deleted {deleted}, inserted {len(uptime_rows)}")

        print("\n── Phase 1d: offline_events ──")
        cur.execute("DELETE FROM offline_events WHERE org_id = %s", (ORG_ID,))
        deleted = cur.rowcount

        rng_offline = random.Random(42)
        offline_rows = []
        for d in downtime_days:
            asset = rng_offline.choice(DEMO_ASSETS)
            cause = rng_offline.choice(OFFLINE_CAUSES)
            duration_hours = rng_offline.uniform(1, 6)
            start_hour = rng_offline.randint(0, max(0, 23 - int(duration_hours)))
            started_at = datetime(
                d.year, d.month, d.day, start_hour, 0, 0,
                tzinfo=timezone(timedelta(hours=-3))
            )
            ended_at = started_at + timedelta(hours=duration_hours)
            offline_rows.append((asset, ORG_ID, started_at, ended_at, cause, False))

        cur.executemany(
            """INSERT INTO offline_events
               (asset_id, org_id, started_at, ended_at, cause, backfill)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            offline_rows,
        )
        print(f"  Deleted {deleted}, inserted {len(offline_rows)}")

        # ══════════════════════════════════════════════════════════
        # PHASE 2: Tier 2 tables
        # ══════════════════════════════════════════════════════════
        print("\n── Phase 2a: revenue_daily ──")
        cur.execute("DELETE FROM revenue_daily WHERE asset_id LIKE 'DEMO-%%'")
        deleted = cur.rowcount
        cur.execute("""
            WITH hourly AS (
                SELECT
                    asset_id,
                    (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                    EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'America/Sao_Paulo')::int AS brt_hour,
                    SUM(COALESCE(pv_power, 0) / 12.0)         AS pv_kwh,
                    SUM(COALESCE(grid_import_kwh, 0))          AS import_kwh,
                    SUM(COALESCE(grid_export_kwh, 0))          AS export_kwh,
                    SUM(GREATEST(0, -COALESCE(battery_power, 0)) / 12.0) AS discharge_kwh,
                    SUM(COALESCE(load_power, 0) / 12.0)        AS load_kwh
                FROM telemetry_history
                WHERE asset_id LIKE 'DEMO-%%'
                GROUP BY asset_id,
                         (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
                         EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'America/Sao_Paulo')
            ),
            daily AS (
                SELECT
                    asset_id, day,
                    SUM(pv_kwh)         AS pv_energy_kwh,
                    SUM(import_kwh)     AS grid_import_kwh,
                    SUM(export_kwh)     AS grid_export_kwh,
                    SUM(discharge_kwh)  AS bat_discharged_kwh,
                    SUM(load_kwh)       AS load_kwh,
                    SUM(import_kwh * CASE
                        WHEN brt_hour >= 18 AND brt_hour < 21 THEN 0.95
                        WHEN brt_hour >= 17 AND brt_hour < 18 THEN 0.72
                        WHEN brt_hour >= 21 AND brt_hour < 22 THEN 0.72
                        ELSE 0.55
                    END)                AS cost_reais,
                    SUM(export_kwh) * 0.25 AS revenue_reais,
                    SUM(load_kwh * CASE
                        WHEN brt_hour >= 18 AND brt_hour < 21 THEN 0.95
                        WHEN brt_hour >= 17 AND brt_hour < 18 THEN 0.72
                        WHEN brt_hour >= 21 AND brt_hour < 22 THEN 0.72
                        ELSE 0.55
                    END)                AS baseline_cost_reais,
                    SUM(pv_kwh) - SUM(export_kwh) AS pv_self_use_kwh
                FROM hourly
                GROUP BY asset_id, day
            )
            INSERT INTO revenue_daily (
                asset_id, date,
                pv_energy_kwh, grid_import_kwh, grid_export_kwh, bat_discharged_kwh,
                cost_reais, revenue_reais, profit_reais,
                baseline_cost_reais, actual_cost_reais, client_savings_reais,
                actual_self_consumption_pct, self_sufficiency_pct,
                tariff_schedule_id, calculated_at
            )
            SELECT
                asset_id, day,
                ROUND(pv_energy_kwh, 3),
                ROUND(grid_import_kwh, 3),
                ROUND(grid_export_kwh, 3),
                ROUND(bat_discharged_kwh, 3),
                ROUND(cost_reais, 2),
                ROUND(revenue_reais, 2),
                ROUND(revenue_reais - cost_reais, 2),
                ROUND(baseline_cost_reais, 2),
                ROUND(cost_reais, 2),
                ROUND(baseline_cost_reais - cost_reais, 2),
                ROUND(CASE WHEN pv_energy_kwh > 0
                    THEN (pv_self_use_kwh / pv_energy_kwh) * 100
                    ELSE 0 END, 2),
                ROUND(CASE WHEN load_kwh > 0
                    THEN (1 - grid_import_kwh / load_kwh) * 100
                    ELSE 0 END, 2)::real,
                %s,
                NOW()
            FROM daily
        """, (tariff_id,))
        inserted = cur.rowcount
        print(f"  Deleted {deleted}, inserted {inserted}")

        print("\n── Phase 2b: algorithm_metrics ──")
        cur.execute("DELETE FROM algorithm_metrics WHERE org_id = %s", (ORG_ID,))
        deleted = cur.rowcount
        cur.execute("""
            INSERT INTO algorithm_metrics (org_id, date, self_consumption_pct)
            SELECT
                %s,
                date,
                ROUND(AVG(actual_self_consumption_pct), 2)
            FROM revenue_daily
            WHERE asset_id LIKE 'DEMO-%%'
            GROUP BY date
        """, (ORG_ID,))
        inserted = cur.rowcount
        print(f"  Deleted {deleted}, inserted {inserted}")

        # ══════════════════════════════════════════════════════════
        # PHASE 3: Tier 3 tables
        # ══════════════════════════════════════════════════════════
        print("\n── Phase 3a: vpp_strategies ──")
        cur.execute("DELETE FROM vpp_strategies WHERE org_id = %s", (ORG_ID,))
        deleted = cur.rowcount
        cur.execute("""
            INSERT INTO vpp_strategies (
                org_id, strategy_name, target_mode,
                min_soc, max_soc,
                charge_window_start, charge_window_end,
                discharge_window_start,
                max_charge_rate_kw, target_self_consumption_pct,
                is_default, is_active
            ) VALUES
                (%s, 'Casa Ribeiro Self-Consumption',
                 'self_consumption', 20, 95,
                 '00:00', '06:00', '18:00',
                 5.0, 85.0, true, true),
                (%s, 'Cafe Aurora Peak Shaving',
                 'peak_shaving', 15, 90,
                 '00:00', '06:00', '18:00',
                 10.0, 75.0, false, true),
                (%s, 'Galpao Estrela Arbitrage',
                 'arbitrage', 10, 95,
                 '00:00', '06:00', '18:00',
                 50.0, 70.0, false, true)
        """, (ORG_ID, ORG_ID, ORG_ID))
        inserted = cur.rowcount
        print(f"  Deleted {deleted}, inserted {inserted}")

        print("\n── Phase 3b: pld_horario ──")
        cur.execute("DELETE FROM pld_horario")
        deleted = cur.rowcount

        pld_rows = []
        # Extend PLD to Mar 13 to cover dispatch_records dates
        pld_end = date(2026, 3, 13)
        for d in date_range(DATE_START, pld_end):
            mes_ref = d.year * 100 + d.month
            day_seed = d.toordinal()
            for hour in range(24):
                price = generate_pld_price(hour, day_seed)
                pld_rows.append((mes_ref, d.day, hour, "SE/CO", price))

        cur.executemany(
            """INSERT INTO pld_horario (mes_referencia, dia, hora, submercado, pld_hora)
               VALUES (%s, %s, %s, %s, %s)""",
            pld_rows,
        )
        print(f"  Deleted {deleted}, inserted {len(pld_rows)}")

        print("\n── Phase 3c: dispatch_records (UPDATE) ──")
        # Idempotent reset
        cur.execute("""
            UPDATE dispatch_records SET
                success = NULL,
                actual_power_kw = NULL,
                response_latency_ms = NULL,
                error_message = NULL
            WHERE asset_id LIKE 'DEMO-%%'
        """)
        reset_count = cur.rowcount
        print(f"  Reset {reset_count} rows")

        cur.execute("""
            SELECT id, commanded_power_kw
            FROM dispatch_records
            WHERE asset_id LIKE 'DEMO-%%'
              AND (success IS NULL OR success = false)
            ORDER BY id
        """)
        dispatch_rows = cur.fetchall()

        rng_dr = random.Random(123)
        success_count = 0
        fail_count = 0
        for row_id, commanded_power_kw in dispatch_rows:
            if rng_dr.random() < 0.60:
                actual = float(commanded_power_kw) * (0.85 + rng_dr.random() * 0.15)
                latency = 200 + int(rng_dr.random() * 800)
                cur.execute("""
                    UPDATE dispatch_records SET
                        actual_power_kw = %s,
                        success = true,
                        response_latency_ms = %s
                    WHERE id = %s
                """, (round(actual, 3), latency, row_id))
                success_count += 1
            else:
                err = rng_dr.choice(DISPATCH_ERRORS)
                cur.execute("""
                    UPDATE dispatch_records SET
                        success = false,
                        error_message = %s
                    WHERE id = %s
                """, (err, row_id))
                fail_count += 1
        print(f"  Success: {success_count}, Failed: {fail_count}")

        print("\n── Phase 3d: dispatch_commands (UPDATE) ──")
        # Idempotent reset: set all non-dispatched back to dispatched
        cur.execute("""
            UPDATE dispatch_commands SET
                status = 'dispatched',
                completed_at = NULL,
                error_message = NULL
            WHERE asset_id LIKE 'DEMO-%%'
              AND status IN ('completed', 'failed')
        """)
        reset_count = cur.rowcount
        print(f"  Reset {reset_count} rows to 'dispatched'")

        # Now select from dispatched (post-reset state)
        cur.execute("""
            SELECT id, dispatched_at
            FROM dispatch_commands
            WHERE asset_id LIKE 'DEMO-%%'
              AND status = 'dispatched'
            ORDER BY id
        """)
        cmd_rows = cur.fetchall()

        rng_dc = random.Random(456)
        completed_count = 0
        failed_count = 0
        for row_id, dispatched_at in cmd_rows:
            if rng_dc.random() < 0.45:
                delay = 2 + rng_dc.random() * 8
                completed_at = dispatched_at + timedelta(seconds=delay)
                cur.execute("""
                    UPDATE dispatch_commands SET
                        status = 'completed',
                        completed_at = %s
                    WHERE id = %s
                """, (completed_at, row_id))
                completed_count += 1
            else:
                err = rng_dc.choice(COMMAND_ERRORS)
                cur.execute("""
                    UPDATE dispatch_commands SET
                        status = 'failed',
                        error_message = %s
                    WHERE id = %s
                """, (err, row_id))
                failed_count += 1
        print(f"  Completed: {completed_count}, Failed: {failed_count}")

        print("\n── Phase 3e: trades ──")
        cur.execute("DELETE FROM trades WHERE asset_id LIKE 'DEMO-%%'")
        deleted = cur.rowcount

        # Only INV assets trade energy
        cur.execute("""
            SELECT id, asset_id, dispatched_at, actual_power_kw
            FROM dispatch_records
            WHERE asset_id LIKE 'DEMO-%%-INV'
              AND success = true
        """)
        successful_dispatches = cur.fetchall()

        trade_rows = []
        for rec_id, asset_id, dispatched_at, actual_power_kw in successful_dispatches:
            # Convert to BRT for PLD lookup
            brt_time = dispatched_at - timedelta(hours=3)
            brt_hour = brt_time.hour
            brt_day = brt_time.day
            brt_month = brt_time.month
            brt_year = brt_time.year
            mes_ref = brt_year * 100 + brt_month

            # Look up PLD price
            cur.execute("""
                SELECT pld_hora FROM pld_horario
                WHERE mes_referencia = %s AND dia = %s AND hora = %s AND submercado = 'SE/CO'
            """, (mes_ref, brt_day, brt_hour))
            pld_row = cur.fetchone()
            if pld_row is None:
                continue
            pld_price_mwh = float(pld_row[0])

            actual_kw = float(actual_power_kw)
            if actual_kw > 0:
                trade_type = "spot_sell"
                energy_kwh = actual_kw / 12.0
            else:
                trade_type = "spot_buy"
                energy_kwh = abs(actual_kw) / 12.0

            price_per_kwh = pld_price_mwh / 1000.0
            total_reais = round(energy_kwh * price_per_kwh, 2)

            trade_rows.append((
                asset_id, dispatched_at, trade_type,
                round(energy_kwh, 3), round(price_per_kwh, 4), total_reais
            ))

        if trade_rows:
            cur.executemany(
                """INSERT INTO trades
                   (asset_id, traded_at, trade_type, energy_kwh, price_per_kwh, total_reais)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                trade_rows,
            )
        print(f"  Deleted {deleted}, inserted {len(trade_rows)}")

        # ══════════════════════════════════════════════════════════
        # COMMIT
        # ══════════════════════════════════════════════════════════
        conn.commit()
        print("\n*** TRANSACTION COMMITTED ***")

        # ══════════════════════════════════════════════════════════
        # PHASE 4: Verification
        # ══════════════════════════════════════════════════════════
        print("\n" + "=" * 60)
        print("VERIFICATION")
        print("=" * 60)

        verification_queries = [
            ("asset_5min_metrics",
             "SELECT COUNT(*) FROM asset_5min_metrics WHERE asset_id LIKE 'DEMO-%%'",
             77760),
            ("asset_hourly_metrics",
             "SELECT COUNT(*) FROM asset_hourly_metrics WHERE asset_id LIKE 'DEMO-%%'",
             6480),
            ("revenue_daily",
             "SELECT COUNT(*) FROM revenue_daily WHERE asset_id LIKE 'DEMO-%%'",
             270),
            ("daily_uptime_snapshots",
             "SELECT COUNT(*) FROM daily_uptime_snapshots WHERE org_id = 'ORG_DEMO_001'",
             90),
            ("offline_events",
             "SELECT COUNT(*) FROM offline_events WHERE org_id = 'ORG_DEMO_001'",
             None),
            ("vpp_strategies",
             "SELECT COUNT(*) FROM vpp_strategies WHERE org_id = 'ORG_DEMO_001'",
             3),
            ("algorithm_metrics",
             "SELECT COUNT(*) FROM algorithm_metrics WHERE org_id = 'ORG_DEMO_001'",
             90),
            ("pld_horario",
             "SELECT COUNT(*) FROM pld_horario",
             2184),  # 91 days x 24h (extended to Mar 13 for dispatch coverage)
            ("trades",
             "SELECT COUNT(*) FROM trades WHERE asset_id LIKE 'DEMO-%%'",
             None),
            ("dispatch_records (success=true)",
             "SELECT COUNT(*) FROM dispatch_records WHERE asset_id LIKE 'DEMO-%%' AND success = true",
             None),
            ("dispatch_commands (completed)",
             "SELECT COUNT(*) FROM dispatch_commands WHERE asset_id LIKE 'DEMO-%%' AND status = 'completed'",
             None),
        ]

        print(f"\n{'Table':<35} {'Actual':>8} {'Expected':>10} {'Status':>8}")
        print("-" * 65)
        for label, query, expected in verification_queries:
            cur.execute(query)
            actual = cur.fetchone()[0]
            if expected is not None:
                status = "OK" if actual == expected else "MISMATCH"
            else:
                status = f"~{actual}"
            print(f"  {label:<33} {actual:>8} {str(expected or '~'):>10} {status:>8}")

        # ── Energy conservation check ──────────────────────────────
        # Correct formula: load = pv - export + discharge + import - charge
        # The DESIGN formula omits the charge term; corrected here.
        print("\n── Energy Conservation Check ──")
        cur.execute("""
            SELECT COUNT(*) FROM (
                SELECT asset_id,
                    date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
                    ABS(
                        SUM(load_power / 12.0)
                        - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
                           + SUM(GREATEST(0, -battery_power) / 12.0)
                           + SUM(grid_import_kwh)
                           - SUM(GREATEST(0, battery_power) / 12.0))
                    ) AS error_kwh
                FROM telemetry_history
                WHERE asset_id LIKE 'DEMO-%%'
                GROUP BY asset_id, date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo')
                HAVING ABS(
                    SUM(load_power / 12.0)
                    - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
                       + SUM(GREATEST(0, -battery_power) / 12.0)
                       + SUM(grid_import_kwh)
                       - SUM(GREATEST(0, battery_power) / 12.0))
                ) > 0.1
            ) violations
        """)
        violations = cur.fetchone()[0]
        print(f"  Violations (>0.1 kWh error): {violations} {'OK' if violations == 0 else 'FAIL'}")

        # ── Revenue sanity check ───────────────────────────────────
        print("\n── Revenue Sanity Check (no negative client_savings) ──")
        cur.execute("""
            SELECT COUNT(*) FROM revenue_daily
            WHERE asset_id LIKE 'DEMO-%%'
              AND client_savings_reais < 0
        """)
        neg_savings = cur.fetchone()[0]
        print(f"  Negative client_savings rows: {neg_savings} {'OK' if neg_savings == 0 else 'FAIL'}")

        # ── Uptime consistency check ───────────────────────────────
        print("\n── Uptime Consistency Check ──")
        cur.execute("""
            SELECT COUNT(*) FROM (
                SELECT d.date,
                    d.total_assets - d.online_assets AS expected_offline,
                    COALESCE(o.cnt, 0) AS actual_offline
                FROM daily_uptime_snapshots d
                LEFT JOIN (
                    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS date,
                        COUNT(*) AS cnt
                    FROM offline_events WHERE org_id = 'ORG_DEMO_001'
                    GROUP BY (started_at AT TIME ZONE 'America/Sao_Paulo')::date
                ) o ON d.date = o.date
                WHERE d.org_id = 'ORG_DEMO_001'
                  AND (d.total_assets - d.online_assets) != COALESCE(o.cnt, 0)
            ) mismatches
        """)
        mismatches = cur.fetchone()[0]
        print(f"  Uptime/offline mismatches: {mismatches} {'OK' if mismatches == 0 else 'FAIL'}")

        print("\n" + "=" * 60)
        print("HYDRATION COMPLETE")
        print("=" * 60)

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        print("TRANSACTION ROLLED BACK")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
