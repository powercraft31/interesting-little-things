# REQ-v6.5-P5-Polish-R3-Micro-Closure-0.1

## Purpose

本文件定義 **P5 v6.5 第三輪微修（Polish R3）** 的需求範圍。

R2 已基本完成 backend overview closure，前後端在資料契約層已大致閉環。
但從產品語義與首頁可解釋性角度，仍有 3 個小型漏風點尚未收口。

本輪目標不是新功能，也不是再做一輪 backend 重構，而是做 **最後一層 micro closure**，讓首頁更接近最終 deploy-ready 的產品語義。

---

## Current Stage

依 `/tmp/solfacil/docs/GUIDE-SOLFACIL.md`，本任務目前處於：

**REQ（Focused Fix / Micro Closure）**

不是 Deploy，不是新一輪大 REQ/DESIGN/PLAN 重做。

---

## Current Assessment After R2

### Already closed
- `calm_explanation` 不再在 non-calm posture 下漏出
- escalation posture 不再顯示 `No active strategy intents`
- `escalate + active` intents 已能進首頁 triage
- 被 protective dominance 壓制的 economic intents 已可進 `watch_next`
- Hero / summary / lanes 基本已在講同一套真相

### Still open
R2 後仍有 3 個小問題：

1. `watch_next` 內 deferred 卡片的 badge / status 語義仍有張力
2. 頁面 / 導航命名仍殘留舊世界觀（`VPP & DR`）
3. deferred counters 的可解釋性不足

---

## Problem Statement

### P1. watch_next lane 中 deferred card 的 badge grammar 尚未完全收口
目前可能出現：
- lane = `watch_next`
- status = `deferred`
- 但 card badge 仍主要呈現 `ESCALAR`

這會造成一種輕度矛盾：
- 泳道語義在說「觀察 / 延後處理」
- 卡片 badge 卻在說「升級 / 需要更高級別處理」

這雖不再像 R1/R2 那樣屬於致命矛盾，但它讓首頁卡片的最終語法還不夠乾淨。

### P2. P5 頁面命名仍為 `VPP & DR`
雖然 P5 的內部語義已被重定義為 **Strategy Trigger Layer**，但頁面標籤 / 導航顯示仍使用：
- `VPP & DR`

這使產品定位持續漏風，造成：
- 首頁語義是 P5 Strategy Trigger
- 導航語義卻仍像舊的 VPP/DR page

### P3. deferred counters 缺乏首頁內可解釋性
目前 context 可顯示：
- `Adiados: N`

但首頁 surfaced cards 可能只呈現其中一部分，導致 operator 會感到：
- count 看起來不為 0
- 但畫面上看不到足夠對應項

如果這個數字沒有最小程度的解釋，它會像黑箱計數器，不符合 P5 的可治理 / 可理解方向。

---

## Product Goal

R3 完成後，首頁必須更接近以下感受：

- Hero 說的是平台姿態
- Triage lanes 呈現的是 operator 該怎麼理解當前世界
- 每張卡片的 badge / lane / status 語法一致
- Context 區的 counters 不再像神祕數字，而是可理解的治理後果摘要
- 導航 / page naming 不再與頁面內涵互相背刺

---

## Scope

### In Scope

#### 1. Frontend card grammar 微調
可能涉及：
- `frontend-v2/js/p5-strategy.js`
- `frontend-v2/js/i18n.js`
- `frontend-v2/css/pages.css`

用途：
- 讓 deferred / escalated / observed 卡片在首頁上有更一致的 badge 與 secondary explanation

#### 2. Frontend page labeling / navigation naming 微調
可能涉及：
- `frontend-v2/js/app.js`
- `frontend-v2/js/i18n.js`
- 或現有 P5 navigation label 對應處

用途：
- 把 `VPP & DR` 收斂成符合 P5 當前產品定義的名稱

#### 3. Context counter explainability 微調
可能涉及：
- `frontend-v2/js/p5-strategy.js`
- `frontend-v2/js/i18n.js`

用途：
- 讓 `deferred_count` / `suppressed_count` 在首頁語義上更可理解
- 不要求做 drill-down 大功能，只要求最小程度的解釋

### Out of Scope

本輪不做：
1. 不改 backend schema
2. 不改 API endpoint
3. 不再重做 `get-p5-overview.ts` 的主 contract
4. 不擴張為新 lane
5. 不新增 detail page / history page
6. 不處理全站 React 重構
7. 不部署

---

## Required Behavioral Contract

### R1. Deferred card grammar 必須以當前首頁語義為主
若一張卡位於 `watch_next`，且其實際狀態是 `deferred`，那首頁對 operator 的主要語義應優先表達：
- 該項目前被延後 / 被壓住 / 被觀察

而不應讓舊 governance_mode 的 badge 壓過當前首頁語義。

#### Allowed approaches
可接受的做法包括：
- 以 `status=deferred` 的 badge 取代主要 badge
- 或主 badge 顯示 deferred / observed，次級資訊再表達其原 governance 背景
- 或在卡上明確呈現「deferred by protective posture」之類的 secondary line

#### Forbidden outcome
不允許首頁 operator 第一眼仍把這張卡理解成「這是現在要 escalate 的 action card」。

### R2. P5 頁面命名必須與其語義一致
P5 導航 / page naming 應收斂到反映當前真實定義的名稱。

#### Acceptance direction
名稱不一定要完美，但至少不能再強烈綁在：
- 舊版 `VPP & DR` worldview

本輪只要求**顯著降低語義誤導**。

### R3. Deferred counters 必須有最小可解釋性
若首頁顯示：
- `Deferred: N`

則 operator 應至少知道這個數字代表：
- 當前被治理邏輯延後的 strategy intents 總數
- 不保證首頁全量列出

#### Acceptance direction
可透過以下任一方式達成：
- 一句 helper text
- 一行 secondary explanation
- 一個 tooltip / note（若現有架構方便）

本輪不要求 drill-down，只要求不再像黑箱數字。

---

## Acceptance Criteria

### A. Card grammar acceptance
1. `watch_next` 中 deferred card 的主語義不再與 lane 語義打架
2. 卡片的 badge / status / secondary text 讓 operator 能理解：
   - 這不是「現在要立刻仲裁的主卡」
   - 這是被延後 / 被壓制 / 觀察中的機會或條件

### B. Naming acceptance
1. 首頁或導航中不再以 `VPP & DR` 作為 P5 的主顯示名稱
2. 新名稱至少能更接近 P5 的現定義

### C. Counter explainability acceptance
1. `Adiados / Deferred` count 有簡單說明
2. Operator 不會再把它誤解為「畫面漏資料」或「神祕黑箱數字」

### D. Negative criteria
本輪不應：
- 引入新的 backend contract
- 增加頁面複雜度
- 把首頁做成 audit page
- 把 Context 區變成長篇說明文

---

## Recommended Next Step

本 REQ 確認後，下一步建議：

1. 先寫一份超短 **DESIGN/PLAN 合併式 micro note**
2. 定義：
   - deferred card badge 怎麼顯示
   - 新 page label 採用哪個名稱
   - deferred counter 的說明文放哪裡
3. 再進 implementation

在這之前：
- 不部署
- 不直接開大工程
