# REQ-v6.5-P5-Polish-R2-Backend-Closure-0.1

## Purpose

本文件定義 **P5 v6.5 第二輪修復（Polish R2）** 的需求範圍。

這一輪不是新功能開發，也不是大範圍重構，而是要修補一個已被 runtime 驗證暴露出的核心問題：

> **P5 首頁的 backend overview read model 與 frontend 首頁敘事尚未閉環，導致頁面出現產品語義自相矛盾。**

本輪目標是把 P5 首頁收口成一個**自洽、低噪音、可治理的 Strategy Trigger workbench 首頁**。

---

## Current Stage

依 `/tmp/solfacil/docs/GUIDE-SOLFACIL.md`，本任務目前處於：

**REQ（Focused Fix / Backend Closure）**

不是 Deploy，不是重新做 REQ/DESIGN 全套，也不是直接啟動 Claude Code。

---

## Background

P5 v6.5 主體已完成：
- REQ / DESIGN / PLAN / REVIEW 已完成
- Schema / M2 / M5 / Frontend / Runtime 驗收已完成一輪
- GitHub base commit 已存在：`440a253`
- EC2 尚未部署

之後進行了產品審查與前端語義 polish R1，發現：

### 問題不是只有前端表達
Runtime 驗證證明，部分最明顯的頁面矛盾其實來自 **backend `GET /api/p5/overview` read model**，而不是單純前端文案或 layout 問題。

也就是：
- frontend R1 有改善
- 但 backend overview contract 本身仍會生成不自洽首頁狀態

因此，本輪修復必須明確納入：

**Backend read model closure + minimal frontend alignment**

而不能再被定義成純前端 polish。

---

## Problem Statement

目前 P5 首頁存在以下已驗證問題：

### P1. Escalation posture 與 calm explanation 同時出現
當前 runtime 可出現：
- hero.posture = `escalation`
- hero.operator_action_needed = true
- 但同時 `calm_explanation.reason = no_conditions_detected`

這會讓首頁同時說：
- 有 escalation / conflict / review needed
- 但又說 no strategy-relevant conditions detected

這是**產品語義自爆**。

### P2. Hero summary 可能輸出「No active strategy intents」但實際有 escalation 狀態
目前 overview handler 的 `governance_summary` 只會彙總：
- need_decision_now
- platform_acting
- watch_next

而 `escalate + active` intents 並未被納入 summary。結果會出現：
- hero posture = escalation
- conflict_active = true
- operator_action_needed = true
- governance_summary = `No active strategy intents`

這是首頁 contract 不成立。

### P3. Escalate active intents 沒有進入 triage lanes
目前三條 lane 分配規則沒有處理：
- `governance_mode = escalate` 且 `status = active`

結果是：
- hero 說需要 operator 介入
- triage lanes 卻可能全空
- frontend 只能用 derived card 硬補

這讓首頁主敘事依賴前端救火，而不是來自 backend 的真實首頁模型。

### P4. Arbitration outcome 尚未完全收斂成首頁可讀狀態
目前某些被 protective intent 壓制的 economic intent，只留下：
- `arbitration_note`

但未明確轉為：
- deferred
- observe
- suppressed
- 或其他首頁可穩定分流的狀態

這使得 homepage triage read model 難以穩定表達：
- 平台正在做什麼
- 哪些東西被壓住
- 哪些需要人決定

### P5. Frontend 正在替 backend contract 補洞
Frontend Polish R1 新增了 derived cards，用來修補：
- hero 說 action needed 但 lane 為空

這個補法有價值，但它應該是**保底機制**，不是首頁語義的主來源。

---

## Product Goal

本輪修復完成後，P5 首頁必須達成以下產品效果：

打開頁面 5 秒內，operator 能回答：

1. 平台現在是什麼姿態？
2. 為什麼它是這個姿態？
3. 平台現在正在做什麼？
4. 我現在是否需要決策？
5. 如果我不動作，接下來會怎樣？

如果首頁不能穩定回答這五題，就視為本輪未完成。

---

## Scope

### In Scope

本輪允許修改：

#### 1. Backend overview read model
主要目標檔：
- `backend/src/bff/handlers/get-p5-overview.ts`

用途：
- 修正 posture / calm_explanation / governance_summary / triage lanes 的語義閉環

#### 2. Backend evaluation / posture semantics（僅最小必要）
可能涉及：
- `backend/src/optimization-engine/services/strategy-evaluator.ts`
- `backend/src/optimization-engine/services/posture-resolver.ts`

用途：
- 若首頁語義缺口無法只靠 overview handler 關閉，允許做最小範圍修補
- 目標不是重寫 evaluator，而是讓 arbitration outcome 至少能穩定支持首頁 triage

#### 3. Backend tests
至少補強：
- `backend/test/bff/p5-overview.test.ts`

必要時增加新的 test cases，確保首頁 contract 不再退化。

#### 4. Minimal frontend alignment
允許對以下檔做最小調整：
- `frontend-v2/js/p5-strategy.js`
- `frontend-v2/js/i18n.js`
- `frontend-v2/css/pages.css`

用途：
- 對齊新的 overview contract
- 移除或降級不再需要的 derived workaround
- 修正仍殘留的 contradictory rendering

### Out of Scope

本輪**不做**以下事情：

1. 不新增 schema / table / migration
2. 不新增新的 API endpoint
3. 不重做 M2 family model
4. 不擴張到 P1~P4
5. 不處理長期 roadmap 問題（如全量 i18n、全站命名重做、React 重構）
6. 不部署到 EC2
7. 不把本輪變成全新 DESIGN 大工程

---

## Required Behavioral Contract

### R1. `calm_explanation` 只允許在 calm posture 下出現
#### Required rule
當且僅當：
- `hero.posture === "calm"`

才允許：
- `calm_explanation !== null`

#### Forbidden state
以下組合必須禁止：
- posture = `escalation` + calm_explanation present
- posture = `approval_gated` + calm_explanation present
- posture = `protective` + calm_explanation present

### R2. Hero summary 必須與 posture 一致
#### Required rule
`hero.governance_summary` 不可再只由三條 lane 被動組合而成。

它必須與實際 posture 對齊，至少保證：
- escalation posture 時，不可輸出 `No active strategy intents`
- operator_action_needed = true 時，summary 不可呈現 calm/empty 語氣

#### Acceptance intent
Hero summary 應回答：
- 當前為何需要介入 / 為何正在保護 / 為何暫無動作

而不是單純數量字串。

### R3. `escalate + active` intents 必須被 triage 消費
#### Required rule
若存在：
- `governance_mode = escalate`
- `status = active`

則首頁 triage 不可三條皆空。

#### Preferred mapping
預設將此類 intent 納入：
- `need_decision_now`

因為它代表：
- unresolved conflict
- operator arbitration needed

#### Allowed alternative
若 DESIGN 更偏向「escalation = specialized lane behavior」，也可在首頁 read model 做等價表達；但不允許讓 escalate item 消失。

### R4. Platform Acting 必須可見
如果當前 posture / dominant protector / override 已經實質影響策略決策，首頁必須讓 operator 看見：
- 平台正在施加何種治理/保護
- 哪些意圖因此被限制 / 被壓住 / 被觀察

不允許只在 context rail 裡藏一個 protector fact，卻讓 `platform_acting` 看起來完全沒有內容。

### R5. Arbitration outcome 必須轉為首頁可讀狀態
若 economic intent 被 protective logic 壓過，系統至少必須穩定表達出以下其中一種：
- 該 intent 已 deferred
- 該 intent 已 observe-only
- 該 intent 仍 active 但被 clearly governed / blocked by protector

不允許只剩 `arbitration_note` 而無法被首頁 triage 明確消費。

### R6. Frontend 不可再依賴 workaround 才維持首頁自洽
Frontend 可保留 derived/fallback 呈現，但新 contract 之下：
- 首頁的主敘事應來自 backend overview data
- derived cards 不應成為修補 backend 空洞的唯一方式

---

## Acceptance Criteria

### A. Backend contract acceptance
對於 `GET /api/p5/overview`，至少必須滿足：

1. **Calm exclusivity**
   - non-calm posture 時，`calm_explanation` 必為 `null`

2. **Summary consistency**
   - escalation posture 時，`governance_summary` 不得為 `No active strategy intents`

3. **Triage coherence**
   - 若 `hero.operator_action_needed === true`，則首頁應有可對應的 triage representation
   - 不可出現 hero 強烈要求決策，但三條 lane 全空

4. **Acting visibility**
   - 若 protective logic / override 正在支配決策，首頁必須有可理解的 acting/guarding 表達

5. **No self-contradiction**
   - 不可再出現「需要 escalated review」同時又說「沒有 strategy-relevant condition」的 response 組合

### B. Frontend acceptance
在 canonical ingress `http://152.42.235.155` 驗證時：

1. Hero 讀起來是 posture-first
2. Hero 與 triage lanes 代表同一套真相
3. Platform Acting 不再空洞到與 hero 相衝突
4. Causal trace 仍保留且可見
5. 頁面整體比 alert wall 更接近 workbench

### C. Test acceptance
至少新增/補強以下 backend 測試：

1. escalation posture 下 `calm_explanation === null`
2. escalation posture 下 `governance_summary` 不為 empty/calm wording
3. escalate active intents 會被首頁 triage 消費
4. protective dominance 情境下，首頁能表達 acting/governance closure

---

## Non-Goals / Negative Criteria

本輪修完後，P5 首頁仍然**不能**退化成：
- KPI dashboard
- event log
- governance settings page
- P4 manual dispatch UI

本輪也不應為了首頁自洽而：
- 發明不存在的 backend fields
- 新增與需求無關的複雜狀態機
- 擴大成新一輪大規模架構重寫

---

## Recommended Next Step

本 REQ 確認後，下一步應該是：

1. 寫一份 **DESIGN/REVIEW style closure note**（針對 overview read model）
2. 明確定義：
   - escalation item 如何進 lane
   - calm_explanation 何時生成
   - governance_summary 生成邏輯
   - acting representation 由 backend 還是 frontend 承擔到哪個程度
3. 再進入 Focused Fix implementation

在這一步之前：
- **不要部署**
- **不要直接再啟動 Claude Code**
