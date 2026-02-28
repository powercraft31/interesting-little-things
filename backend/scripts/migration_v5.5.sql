-- ============================================================
-- Solfacil VPP v5.5 Migration — 雙層經濟模型
-- ============================================================
-- 變更摘要：
--   新增 3 張表：pld_horario / trade_schedules / algorithm_metrics
--   擴充 3 張表：assets / revenue_daily / vpp_strategies
-- 冪等性：所有語句可重複執行不報錯（CREATE IF NOT EXISTS + DO $$ IF NOT EXISTS）
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 新增 pld_horario：CCEE 批發市場每小時電價
-- ============================================================

CREATE TABLE IF NOT EXISTS pld_horario (
    mes_referencia INT NOT NULL,
    dia            SMALLINT NOT NULL,
    hora           SMALLINT NOT NULL,
    submercado     VARCHAR(10) NOT NULL CHECK (submercado IN ('SUDESTE','SUL','NORDESTE','NORTE')),
    pld_hora       NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (mes_referencia, dia, hora, submercado)
);
COMMENT ON TABLE pld_horario IS 'CCEE 批發市場每小時電價，4個子市場，來源：dadosabertos.ccee.org.br';

-- ============================================================
-- 2. 新增 trade_schedules：M2 最佳化排程輸出
-- ============================================================

CREATE TABLE IF NOT EXISTS trade_schedules (
    id                  SERIAL PRIMARY KEY,
    asset_id            VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
    org_id              VARCHAR(50) NOT NULL,
    planned_time        TIMESTAMPTZ NOT NULL,
    action              VARCHAR(10) NOT NULL CHECK (action IN ('charge','discharge','idle')),
    expected_volume_kwh NUMERIC(8,2) NOT NULL,
    target_pld_price    NUMERIC(10,2),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 新增 algorithm_metrics：演算法商業健康度 KPI
-- ============================================================

CREATE TABLE IF NOT EXISTS algorithm_metrics (
    id                   SERIAL PRIMARY KEY,
    org_id               VARCHAR(50) NOT NULL,
    date                 DATE NOT NULL,
    self_consumption_pct NUMERIC(5,2),
    UNIQUE (org_id, date)
);
COMMENT ON TABLE algorithm_metrics IS '演算法 KPI：僅保留商業健康度指標，不含技術精度指標（alpha/MAPE）';

-- ============================================================
-- 4. 擴充 assets 表：submercado + retail_rates
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='assets' AND column_name='submercado') THEN
        ALTER TABLE assets
            ADD COLUMN submercado           VARCHAR(10) NOT NULL DEFAULT 'SUDESTE'
                CHECK (submercado IN ('SUDESTE','SUL','NORDESTE','NORTE')),
            ADD COLUMN retail_buy_rate_kwh  NUMERIC(8,4) NOT NULL DEFAULT 0.80,
            ADD COLUMN retail_sell_rate_kwh NUMERIC(8,4) NOT NULL DEFAULT 0.25;
        COMMENT ON COLUMN assets.submercado IS 'CCEE 子市場區域，決定該資產使用哪個 pld_horario 做套利計算';
        COMMENT ON COLUMN assets.retail_buy_rate_kwh IS 'C端零售合約：客戶買電費率（預設 Aneel 均價）';
        COMMENT ON COLUMN assets.retail_sell_rate_kwh IS 'C端零售合約：餘電賣回費率（預設淨計量費率）';
    END IF;
END $$;

-- ============================================================
-- 5. 擴充 revenue_daily 表：雙軌收益欄位
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='revenue_daily' AND column_name='vpp_arbitrage_profit_reais') THEN
        ALTER TABLE revenue_daily
            ADD COLUMN vpp_arbitrage_profit_reais NUMERIC(12,2),
            ADD COLUMN client_savings_reais        NUMERIC(12,2),
            ADD COLUMN actual_self_consumption_pct NUMERIC(5,2);
        COMMENT ON COLUMN revenue_daily.vpp_arbitrage_profit_reais IS 'B端：∑(PLD_discharge - PLD_charge) × kWh，進 SOLFACIL 口袋';
        COMMENT ON COLUMN revenue_daily.client_savings_reais IS 'C端：∑ solar_direct_kwh × retail_buy_rate，客戶電費節省';
    END IF;
END $$;

-- ============================================================
-- 6. 擴充 vpp_strategies 表：self_consumption 門檻
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='vpp_strategies' AND column_name='target_self_consumption_pct') THEN
        ALTER TABLE vpp_strategies
            ADD COLUMN target_self_consumption_pct NUMERIC(5,2) DEFAULT 80.0;
        COMMENT ON COLUMN vpp_strategies.target_self_consumption_pct IS 'M2 最佳化約束：self_consumption ≥ 此門檻';
    END IF;
END $$;

COMMIT;
