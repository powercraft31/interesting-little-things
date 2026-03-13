# P3 Asset History View — 分階段實施計劃

> **版本**: v5.24
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.24.md](./00_MASTER_ARCHITECTURE_v5.24.md)
> **日期**: 2026-03-13
> **說明**: P3 Asset History View（P3-1 能量流 + P3-2 設備健康）的 3 階段實施計劃
> **前置依賴**: v5.22 已完成（telemetry_history UNIQUE INDEX, queryWithOrg, tarifa.ts）

---

## 實施概覽

| Phase | 名稱 | 範圍 | 前置依賴 |
|-------|------|------|----------|
| **Phase 1** | Backend API | 2 handler + 路由註冊 + 測試 | 無（可立即開始） |
| **Phase 2** | Frontend P3-1 能量流 | 日期選擇器 + 日視圖折線 + 週月年長條 + 摘要卡片 | Phase 1 |
| **Phase 3** | Frontend P3-2 設備健康 | SOC/SOH/溫度 + DO 事件表 | Phase 1 |

> Phase 2 和 Phase 3 可並行開發（不同開發者），但均依賴 Phase 1 API。

---

## Phase 1: Backend API

### 目標

實作 2 個 BFF handler + 路由註冊，提供 P3 前端所需的所有數據。

### 文件清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `backend/src/bff/handlers/get-asset-telemetry.ts` | **NEW** | 多粒度遙測查詢 + summary + savings |
| `backend/src/bff/handlers/get-asset-health.ts` | **NEW** | 設備健康數據 + DO 事件 |
| `backend/scripts/local-server.ts` | **MODIFY** | 新增 2 個路由 |

### 實施步驟

#### Step 1.1: get-asset-telemetry.ts

1. 建立檔案，匯入 `extractTenantContext`, `requireRole`, `apiError`, `queryWithOrg`, `ok`, `getRateForHour`
2. 實作入參驗證：from, to (required), resolution (optional, default '5min')
3. 實作 resolution 分支 SQL（4 種：5min / hour / day / month）
4. 實作 summary 獨立查詢（per-day MAX → cross-day SUM）
5. 實作 tariff_schedules 查詢（org_id WHERE, effective_to filter）
6. 實作 savings 計算邏輯（hypothetical - actual）
7. 組裝 response：points[] + summary{}

**參考模式**：`get-gateway-energy.ts`（路徑解析、Promise.all、tariff 計算、ok 回傳）

#### Step 1.2: get-asset-health.ts

1. 建立檔案，同樣匯入 auth + db 模組
2. 實作入參驗證：from, to (required)
3. 實作 8 路並行查詢（Promise.all）：
   - Q1: 最新狀態（LIMIT 1）
   - Q2: SOC 歷史（原始 5 分鐘）
   - Q3: SOH 每日趨勢（date_trunc day + AVG）
   - Q4: 溫度歷史（原始 5 分鐘）
   - Q5: 電池循環數（per-day MAX discharge → SUM）
   - Q6: DO 事件（LAG window function）
   - Q7: Asset capacity_kwh
   - Q8: 電壓/電流歷史（battery_voltage + battery_current）
4. 計算 batteryCycles = totalDischarge / capacityKwh
5. 計算 DO 事件持續時間
6. 組裝 response

**參考模式**：`get-device-detail.ts`（asset 路徑解析、多路 Promise.all）

#### Step 1.3: 路由註冊

在 `local-server.ts` 新增（注意 `wrapHandler` 需要 3 個參數：handler, method, path）：
```typescript
import { handler as getAssetTelemetryHandler } from '../src/bff/handlers/get-asset-telemetry';
import { handler as getAssetHealthHandler } from '../src/bff/handlers/get-asset-health';

app.get('/api/assets/:assetId/telemetry', wrapHandler(getAssetTelemetryHandler, 'GET', '/api/assets/:assetId/telemetry'));
app.get('/api/assets/:assetId/health', wrapHandler(getAssetHealthHandler, 'GET', '/api/assets/:assetId/health'));
```

### 測試清單

| # | 測試項目 | 預期結果 |
|---|----------|----------|
| 1 | telemetry 5min resolution, 1 天 | 288 points, 正確排序 |
| 2 | telemetry hour resolution, 1 天 | 24 points, AVG 正確 |
| 3 | telemetry day resolution, 7 天 | 7 points, MAX(pv_daily_energy_kwh) 正確 |
| 4 | telemetry month resolution, 3 月 | 3 points |
| 5 | telemetry summary selfConsumption | (pvTotal - gridExport) / pvTotal * 100 |
| 6 | telemetry summary selfSufficiency | (loadTotal - gridImport) / loadTotal * 100 |
| 7 | telemetry summary savings | 與手算 Tarifa Branca 結果一致 |
| 8 | telemetry 400 缺 from/to | 400 Bad Request |
| 9 | telemetry 400 非法 resolution | 400 Bad Request |
| 10 | telemetry 404 不存在 asset | 404 Not Found |
| 11 | telemetry RLS 隔離 | 不同 org 看不到 |
| 12 | health current 最新狀態 | soc/soh/temp/status 正確 |
| 13 | health SOH 趨勢 | 每日 AVG(battery_soh) |
| 14 | health 電池循環數 | totalDischarge / capacityKwh |
| 15 | health DO 事件 | 正確的 start/end/durationMin |
| 16 | health 無 DO 事件 | doEvents = [] |
| 17 | health 400 缺 from/to | 400 Bad Request |
| 18 | health 404 不存在 asset | 404 Not Found |

### 驗收標準

- [ ] 2 個 handler 通過所有 18 項測試
- [ ] 所有查詢使用 `queryWithOrg`（App Pool compliant）
- [ ] savings 計算與 `shared/tarifa.ts` 的 `getRateForHour` 一致
- [ ] 路由在 local-server.ts 正確註冊並可訪問

---

## Phase 2: Frontend P3-1 能量流

### 目標

實作 P3-1 Energy Flow 頁面，包含日期選擇器、粒度切換、ECharts 圖表、摘要卡片。

### 文件清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `frontend-v2/js/p3-energy.js` | **NEW** | P3-1 頁面邏輯 |
| `frontend-v2/js/data-source.js` | **MODIFY** | 新增 `asset.telemetry()` |
| `frontend-v2/js/app.js` | **MODIFY** | 擴展 router 支援參數化 hash route（`#asset-energy/:assetId`） |
| `frontend-v2/index.html` | **MODIFY** | 路由 + script 引入 + P3-1 HTML 結構 |

### 實施步驟

#### Step 2.1: data-source.js 擴充

新增 `asset` namespace：
```javascript
var asset = {
  telemetry: function(assetId, from, to, resolution) {
    var qs = '?from=' + encodeURIComponent(from)
           + '&to=' + encodeURIComponent(to);
    if (resolution) qs += '&resolution=' + resolution;
    return withFallback(function() {
      return apiGet('/api/assets/' + assetId + '/telemetry' + qs);
    }, {});
  },
  health: function(assetId, from, to) {
    var qs = '?from=' + encodeURIComponent(from)
           + '&to=' + encodeURIComponent(to);
    return withFallback(function() {
      return apiGet('/api/assets/' + assetId + '/health' + qs);
    }, {});
  }
};
```

在 return 區塊新增 `asset: asset`。

#### Step 2.2: 日期選擇器 + 粒度切換

- 使用原生 `<input type="date">` + 自訂快捷按鈕（今天/昨天/7天/30天/自訂）
- 粒度切換按鈕組：日/週/月/年
- 左右箭頭切換前/後一期
- 日期變更 → 重新呼叫 API → 重繪圖表

#### Step 2.3: 日視圖折線圖（ECharts）

- X 軸：00:00 → 23:55，5 分鐘間隔
- Y 軸左：功率 (kW)
- Y 軸右：SOC (%)
- 5 條折線：pv_power（黃）、load_power（藍）、battery_power（綠）、grid_power_kw（紅）、battery_soc（灰虛線，右軸）

#### Step 2.4: 週/月/年堆疊長條圖（ECharts）

- X 軸：日期標籤（7/30/12 根 bar）
- Y 軸：能量 (kWh)
- 堆疊：PV 自用（黃）、電池淨放電（綠）、電網進口（紅）
- 疊加折線：PV 總發電量

#### Step 2.5: 摘要卡片

8 張卡片：PV 總發電、總消費、電網進口、電網出口、自消費率、自給率、日峰值需量、節省金額

### 測試清單

| # | 測試項目 | 預期結果 |
|---|----------|----------|
| 1 | 日期選擇器快捷按鈕 | 今天/昨天/7天/30天 正確設置日期範圍 |
| 2 | 左右箭頭切換 | 日模式切一天，週模式切一週 |
| 3 | 粒度切換 | 日→折線，週/月/年→長條 |
| 4 | 日視圖 5 條折線 | 數據正確，顏色對應 |
| 5 | SOC 右軸 0-100% | 虛線，範圍正確 |
| 6 | 週視圖 7 根 bar | 堆疊正確，PV 折線疊加 |
| 7 | 摘要卡片 8 張 | 數值與 API summary 一致 |
| 8 | 節省金額顯示 | `R$ X.XX (估算)` 格式 |
| 9 | 空數據日期 | 圖表空白，摘要全 0 |
| 10 | URL hash 路由 | `#asset-energy/ASSET_ID` 正確載入 |

### 驗收標準

- [ ] 日/週/月/年 4 種視圖均可正確切換
- [ ] 日期選擇器（快捷 + 箭頭 + 自訂）功能正常
- [ ] 8 張摘要卡片數值正確
- [ ] ECharts 圖表響應式佈局
- [ ] 不引入新套件（ECharts 已有，日期用原生 input）

---

## Phase 3: Frontend P3-2 設備健康

### 目標

實作 P3-2 Equipment Health 頁面，包含電池/逆變器健康圖表和 DO 事件紀錄表。

### 文件清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `frontend-v2/js/p3-health.js` | **NEW** | P3-2 頁面邏輯 |
| `frontend-v2/js/data-source.js` | **已在 Phase 2 修改** | `asset.health()` 已新增 |
| `frontend-v2/index.html` | **已在 Phase 2 修改** | 路由 + script 引入 |

### 實施步驟

#### Step 3.1: 摘要卡片

6 張卡片：當前 SOC、當前 SOH、電池溫度、逆變器溫度、電池循環數、電池工作狀態

#### Step 3.2: 電池 SOC 歷史（ECharts 折線）

- 日視圖：5 分鐘分辨率，Y 軸 0-100%
- 週/月視圖：需前端用 hourly 數據（或後端提供 hourly AVG）
- 配色：綠色漸層填充

#### Step 3.3: SOH 趨勢（ECharts 折線）

- 月/年視圖：每日一個點
- Y 軸：95-100%（局部放大觀察退化）
- 配色：藍色

#### Step 3.4: 溫度雙折線（ECharts）

- battery_temperature（紅）+ inverter_temp（橘）
- 日視圖：5 分鐘分辨率
- 疊加環境溫度參考線（placeholder，目前無數據）

#### Step 3.5: 電壓/電流圖（ECharts）

- battery_voltage（藍）+ battery_current（紫）
- 日視圖觀察 CC/CV 充電模式

#### Step 3.6: DO 事件表

- HTML 表格（無需 ECharts）
- 欄位：開始時間、結束時間、持續分鐘數
- 僅 GW-3 有 DO 事件（其他 gateway 空表格）
- 排序：最新在前

### 測試清單

| # | 測試項目 | 預期結果 |
|---|----------|----------|
| 1 | 摘要卡片 6 張 | 與 API current 一致 |
| 2 | SOC 歷史折線 | 0-100% 範圍，趨勢正確 |
| 3 | SOH 趨勢折線 | 遞減趨勢可見 |
| 4 | 溫度雙折線 | bat/inv 兩條線，標籤正確 |
| 5 | 電壓/電流 | CC/CV 模式可觀察 |
| 6 | DO 事件表 | 3 段事件，durationMin 正確 |
| 7 | 無 DO 事件 | 表格顯示「無 DO 事件紀錄」 |
| 8 | Tab 切換 | P3-1 ↔ P3-2 正確切換 |
| 9 | URL hash 路由 | `#asset-health/ASSET_ID` 正確載入 |
| 10 | 共用日期選擇器 | 日期/粒度變更同步影響 P3-2 |

### 驗收標準

- [ ] 6 張摘要卡片數值正確
- [ ] 4 個 ECharts 圖表正常顯示
- [ ] DO 事件表正確列出事件區間
- [ ] P3-1 ↔ P3-2 tab 切換保持日期狀態
- [ ] 不引入新套件

---

## 風險項和邊界條件

### 風險項

| # | 風險 | 影響 | 緩解措施 |
|---|------|------|----------|
| R1 | telemetry_history 查詢效能（年視圖 ~105K rows） | 頁面載入慢 | 利用 idx_telemetry_unique_asset_time 索引 + 分區剪裁；若仍慢可加 asset_id+recorded_at covering index |
| R2 | savings 計算與 M4 batch 結果不一致 | 使用者困惑 | 前端標註「估算」；差異原因已記錄於 M4 v5.24 §2.3 |
| R3 | DO 事件 window function 在大數據集上性能 | 查詢慢 | DO 事件通常稀疏（每日 0-3 次），LAG window function 效能可接受 |
| R4 | tariff_schedules 無 org_id 匹配 | savings = null | 前端顯示「暫無電價資料」 |
| R5 | 電池 capacity_kwh = 0 或 NULL | 循環數除零 | 程式碼保護：capacityKwh <= 0 時 cycles = 0 |

### 邊界條件

| # | 邊界條件 | 處理方式 |
|---|----------|----------|
| B1 | 選定日期無遙測數據 | points = [], summary 全 0, selfConsumption/selfSufficiency = null |
| B2 | PV 系統無安裝（pvTotal = 0） | selfConsumption = null（避免除零） |
| B3 | 完全離網（gridImport = 0） | selfSufficiency = 100% |
| B4 | DO 事件跨越 from/to 邊界 | 只顯示 from-to 範圍內的 start；end 可能在範圍外（顯示為「進行中」） |
| B5 | 資產類型為 SMART_METER（非 INVERTER_BATTERY） | health 端點仍可用，但 SOC/SOH/battery 相關欄位全 null |
| B6 | 月視圖只有 3 個月數據 | 其餘月份空白（前端不補零） |
| B7 | 日期選擇器選擇未來日期 | points = []（無數據），不攔截 |

---

## 依賴檢查清單

| 依賴項 | 狀態 | 說明 |
|--------|------|------|
| telemetry_history UNIQUE INDEX | ✅ v5.22 已建立 | idx_telemetry_unique_asset_time (asset_id, recorded_at) |
| queryWithOrg | ✅ v5.20 已更新 | (sql, params, orgId\|null) 簽名 |
| shared/tarifa.ts | ✅ v5.14 已存在 | classifyHour(), getRateForHour() |
| tariff_schedules.feed_in_rate | ✅ v5.4 已存在 | 出口電價欄位 |
| assets.capacity_kwh | ✅ v5.4 已存在 | 電池容量 |
| ECharts | ✅ 前端已引入 | 無需新套件 |
| 原生 date input | ✅ 瀏覽器內建 | 無需套件 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| **v5.24** | **2026-03-13** | **初版：P3 Asset History View 3 階段實施計劃。Phase 1 Backend API（2 handler + 路由 + 18 項測試）；Phase 2 Frontend P3-1 能量流（日期選擇器 + 日/週/月/年視圖 + 摘要卡片 + 10 項測試）；Phase 3 Frontend P3-2 設備健康（SOC/SOH/溫度/電壓 + DO 事件表 + 10 項測試）；5 風險項 + 7 邊界條件** |
