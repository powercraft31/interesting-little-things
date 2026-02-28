-- ============================================================
-- Solfacil VPP v5.5 Seed Data — 雙層經濟模型 Demo 資料
-- ============================================================
-- 前提：先執行 migration_v5.5.sql
-- 冪等性：ON CONFLICT DO NOTHING / UPDATE WHERE 確保可重複執行
-- ============================================================

BEGIN;

-- ============================================================
-- Part A：pld_horario — CCEE 批發市場每小時電價（672 筆）
-- 日期範圍：2026-01-01 ~ 2026-01-07（mes_referencia=202601, dia=1-7）
-- 4 子市場 × 7 天 × 24 小時 = 672 筆
-- 電價模型模擬真實 CCEE 日內曲線（R$/MWh）：
--   00-05h 低谷（充電）  | 06-11h 爬升
--   12-15h 太陽能削峰    | 16-17h 再爬升
--   18-21h 傍晚尖峰（放電）| 22-23h 退峰
-- ============================================================

INSERT INTO pld_horario (mes_referencia, dia, hora, submercado, pld_hora)
SELECT
    202601 AS mes_referencia,
    d AS dia,
    h AS hora,
    sm AS submercado,
    ROUND((
        CASE
            WHEN h BETWEEN 0 AND 5   THEN 80  + (h * 8)           -- 低谷 80-120
            WHEN h BETWEEN 6 AND 11  THEN 150 + ((h-6) * 20)      -- 爬升 150-250
            WHEN h BETWEEN 12 AND 15 THEN 170 - ((h-12) * 10)     -- 太陽能削峰 130-170
            WHEN h BETWEEN 16 AND 17 THEN 220 + ((h-16) * 130)    -- 再爬升 220-350
            WHEN h BETWEEN 18 AND 21 THEN 380 + ((h-18) * 57)     -- 尖峰 380-551
            ELSE                          250 - ((h-22) * 35)     -- 退峰 215-250
        END
        * CASE sm
            WHEN 'SUDESTE'  THEN 1.00
            WHEN 'SUL'      THEN 0.97
            WHEN 'NORDESTE' THEN 1.06
            WHEN 'NORTE'    THEN 1.09
          END
        + (RANDOM() * 20 - 10)                                     -- ±10 隨機擾動
    )::NUMERIC, 2) AS pld_hora
FROM
    generate_series(1, 7) AS d,
    generate_series(0, 23) AS h,
    unnest(ARRAY['SUDESTE','SUL','NORDESTE','NORTE']) AS sm
ON CONFLICT (mes_referencia, dia, hora, submercado) DO NOTHING;

-- ============================================================
-- Part B：assets submercado + retail_rates 更新
-- 依據地理位置設定各資產的子市場與費率
-- ============================================================

UPDATE assets SET submercado = 'SUDESTE', retail_buy_rate_kwh = 0.85, retail_sell_rate_kwh = 0.28
WHERE asset_id = 'ASSET_SP_001';

UPDATE assets SET submercado = 'SUDESTE', retail_buy_rate_kwh = 0.82, retail_sell_rate_kwh = 0.26
WHERE asset_id = 'ASSET_RJ_002';

UPDATE assets SET submercado = 'SUDESTE', retail_buy_rate_kwh = 0.79, retail_sell_rate_kwh = 0.24
WHERE asset_id = 'ASSET_MG_003';

UPDATE assets SET submercado = 'SUL',     retail_buy_rate_kwh = 0.76, retail_sell_rate_kwh = 0.23
WHERE asset_id = 'ASSET_PR_004';

-- ============================================================
-- Part C：trade_schedules — 今日充放電排程
-- 每個 asset 各 5 筆排程（2 充電 + 3 放電）
-- planned_time 使用 CURRENT_DATE + interval，確保每次 seed 都是「今日」
-- ============================================================

-- 先清除今日已存在的排程（冪等性：重複 seed 不會累積重複資料）
DELETE FROM trade_schedules
WHERE planned_time::DATE = CURRENT_DATE;

-- ASSET_SP_001 (org: ORG_ENERGIA_001, submercado: SUDESTE)
INSERT INTO trade_schedules (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price) VALUES
('ASSET_SP_001', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '2 hours',    'charge',    7.50, 88.00),
('ASSET_SP_001', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '4 hours',    'charge',    6.20, 112.00),
('ASSET_SP_001', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '18 hours',   'discharge', 5.80, 395.00),
('ASSET_SP_001', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '19 hours 30 minutes', 'discharge', 4.50, 438.00),
('ASSET_SP_001', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '20 hours',   'discharge', 3.90, 480.00);

-- ASSET_RJ_002 (org: ORG_ENERGIA_001, submercado: SUDESTE)
INSERT INTO trade_schedules (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price) VALUES
('ASSET_RJ_002', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '2 hours 30 minutes', 'charge',    8.00, 92.00),
('ASSET_RJ_002', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '4 hours 30 minutes', 'charge',    5.50, 118.00),
('ASSET_RJ_002', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '18 hours',   'discharge', 6.20, 390.00),
('ASSET_RJ_002', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '19 hours',   'discharge', 5.10, 425.00),
('ASSET_RJ_002', 'ORG_ENERGIA_001', CURRENT_DATE + INTERVAL '20 hours 30 minutes', 'discharge', 4.30, 495.00);

-- ASSET_MG_003 (org: ORG_SOLARBR_002, submercado: SUDESTE)
INSERT INTO trade_schedules (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price) VALUES
('ASSET_MG_003', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '1 hour 30 minutes', 'charge',    6.80, 84.00),
('ASSET_MG_003', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '3 hours 30 minutes', 'charge',    5.90, 105.00),
('ASSET_MG_003', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '18 hours 30 minutes', 'discharge', 5.50, 410.00),
('ASSET_MG_003', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '19 hours 30 minutes', 'discharge', 4.80, 445.00),
('ASSET_MG_003', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '21 hours',   'discharge', 3.60, 510.00);

-- ASSET_PR_004 (org: ORG_SOLARBR_002, submercado: SUL)
INSERT INTO trade_schedules (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price) VALUES
('ASSET_PR_004', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '2 hours',    'charge',    7.00, 85.36),
('ASSET_PR_004', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '4 hours',    'charge',    6.40, 108.64),
('ASSET_PR_004', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '18 hours',   'discharge', 6.00, 383.60),
('ASSET_PR_004', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '19 hours',   'discharge', 5.20, 412.15),
('ASSET_PR_004', 'ORG_SOLARBR_002', CURRENT_DATE + INTERVAL '20 hours',   'discharge', 4.10, 465.60);

-- ============================================================
-- Part D：revenue_daily — 補充雙軌收益欄位（UPDATE 已有資料）
-- revenue_daily 已有過去 7 天的資料（UNIQUE asset_id+date），不能重複 INSERT
-- 對所有過去 7 天的記錄做 UPDATE
-- ============================================================

UPDATE revenue_daily
SET
    vpp_arbitrage_profit_reais  = ROUND((RANDOM() * 80 + 40)::NUMERIC, 2),   -- R$40-120 每日套利
    client_savings_reais        = ROUND((RANDOM() * 15 + 8)::NUMERIC, 2),    -- R$8-23 客戶省電
    actual_self_consumption_pct = ROUND((RANDOM() * 12 + 82)::NUMERIC, 1)    -- 82-94%
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
  AND date < CURRENT_DATE;

-- ============================================================
-- Part E：algorithm_metrics — 過去 7 天 KPI
-- 2 個 org × 7 天 = 14 筆
-- ============================================================

INSERT INTO algorithm_metrics (org_id, date, self_consumption_pct)
SELECT
    org_id,
    d::DATE AS date,
    ROUND((RANDOM() * 12 + 82)::NUMERIC, 1) AS self_consumption_pct
FROM
    (VALUES ('ORG_ENERGIA_001'), ('ORG_SOLARBR_002')) AS orgs(org_id),
    generate_series(
        CURRENT_DATE - INTERVAL '7 days',
        CURRENT_DATE - INTERVAL '1 day',
        '1 day'
    ) AS d
ON CONFLICT (org_id, date) DO NOTHING;

COMMIT;
