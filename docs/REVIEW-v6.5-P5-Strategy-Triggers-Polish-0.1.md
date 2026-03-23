# REVIEW-v6.5-P5-Strategy-Triggers-Polish-0.1

## Purpose

本文件不是技術 bug list，而是 **P5 Strategy Triggers 首頁是否真正符合產品定義** 的需求導向審查。

審查基線：
- REQ-v6.5-P5-Strategy-Triggers-1.0.md
- DESIGN-v6.5-P5-Strategy-Triggers-1.0.md
- PLAN-v6.5-P5-Strategy-Triggers-1.0.md
- Runtime screenshot (canonical ingress)
- Live runtime observation on `http://152.42.235.155`

---

## Executive Verdict

**結論：方向正確，但首頁語義尚未收口。**

目前版本已經成功脫離舊 VPP KPI / DR shell，具備：
- posture hero
- triage lanes
- context
- posture override

但從需求角度看，它仍然更像：
- alert center + governance side panel

而不是我們定義的：
- **governed strategy intent workbench**

### 判定
- 架構方向：正確
- 需求落地：部分到位
- 可部署性：技術上可，但產品上不應立刻部署

---

## What Is Working (Keep)

### 1. Homepage skeleton is correct
保留以下四塊：
- Hero
- Need Decision Now
- Platform Acting
- Watch Next
- Context
- Override section

這個骨架不應推倒重來。

### 2. Watch Next card pattern is close to target
目前 watch_next 裡的 intent card 已包含：
- reason_summary
- scope_summary
- time_pressure
- governance/status badge

這是最接近 P5 card grammar 的區塊，應作為其他 lane 的語義模板。

### 3. Governance visibility is materially improved
已能看見：
- override active
- dominant protector
- governance mode
- override actions

這符合 P5 的 governable requirement，不應退回黑盒。

---

## Critical Gaps

### Gap 1 — Hero is still event-first, not posture-first
目前 hero 主要在講：
- 某個 escalation / 某個 arbitrage opportunity / 某個 conflict

但 REQ 定義的 hero 應先回答：
- 平台當前姿態是什麼
- 平台現在在優先保護什麼
- 平台因此壓制/延後了什麼
- 是否需要人類介入

#### Required correction
Hero 必須從「incident card」改成「platform posture statement」。

#### Target grammar
- Primary sentence: 現在的平台姿態
- Secondary sentence: 姿態成因 + 被壓制/被保護的對象
- Tertiary strip: operator action needed / override active / conflict summary

#### Example target (for current runtime)
- **當前姿態：Protective**
- 平台正在優先保護 reserve，因此暫時不放行 tariff arbitrage。
- 1 個 override 生效、1 個經濟型機會被壓制，需決定是否維持保護姿態。

### Gap 2 — Triage lanes and hero tell different stories
目前 runtime 狀態下：
- hero 顯示 escalation + action needed
- Need Decision Now 為空
- Platform Acting 為空
- Watch Next 有一張 observe 卡

這造成首頁主敘事矛盾。

#### Required correction
首頁只能有一套真相：
- hero 不可說「現在要決策」
- 但 decision lane 同時為空

#### Reallocation rule
- **Need Decision Now**：放所有真正需要 operator 做決策的 item
- **Platform Acting**：放平台正在執行/正在強制維持的姿態或 guardrail
- **Watch Next**：放 observe-only、deferred、time-window approaching 的候選意圖

#### For current runtime, expected composition
- Hero：Protective posture statement
- Need Decision Now：一張「檢視 protective override 是否應維持」的 decision item
- Platform Acting：一張「protective override 正在壓制 economic intent」的 acting item
- Watch Next：保留 tariff arbitrage opportunity，但明確標示目前被壓制/觀察中

### Gap 3 — Explainability is fragmented, not causal
目前頁面把資訊分散在：
- hero
- reason line
- dominant protector
- override section
- watch_next card

操作者需要自己拼圖，這不符合 P5 explainability doctrine。

#### Required correction
每個重要策略項應能直接說出：
- why now
- why not auto
- what is blocking or governing it
- what happens next

#### Required one-line causal chain
格式建議：
- Trigger detected → qualified as X → protector/override forced Y → next path Z

### Gap 4 — Governance visible but not governable enough
目前可見 override 與 protector，但缺少：
- who created override
- when created
- expires_at
- why still active
- impact summary

#### Required correction
Override 卡至少新增：
- set by
- start time
- expiry / remaining time
- scope
- impact summary（e.g. suppressing 1 economic intent across 4 gateways）

### Gap 5 — Page is still too noisy for a low-noise workbench
目前 hero 上多個 badge（override/conflict/action needed）疊加後，視覺上像 alert wall。

#### Required correction
- 減少 badge 數量
- 改成 posture sentence + compact status strip
- 避免三個 badge 都描述同一件複合事件

### Gap 6 — Context is informative but too detached from workflow
目前 context 區塊提供很多事實，但其 workflow 位置偏像 side info。

#### Required correction
Context 應服務 triage，而不是跟 triage 平行。

建議：
- 保留 context，但變成 proof rail
- 只保留對當前 triage 決策真正有用的 summary
- 其餘細節下沉到 detail panel

---

## Non-Critical But Important Gaps

### 1. Dynamic business prose remains English
這是後端 evaluator 產生的文案，不屬於前端 bug。

### 2. Time-pressure prose is still generic
例如 `Expires in 2h` 仍是系統字串，未完全符合產品語氣。

### 3. Strategy space is still too narrow
首頁只顯示 surfaced intents，尚未充分表現「平台其實持續在評估多個 strategy families」。

這不是當前 polish 的第一優先，但在之後版本值得補。

---

## Required Homepage Contract After Polish

打開首頁後，操作者必須能在 5 秒內回答四個問題：

1. 平台現在是什麼姿態？
2. 為什麼它是這個姿態？
3. 我現在要不要做決策？
4. 如果我不動作，接下來會怎樣？

如果首頁不能在 5 秒內回答這四題，就還不是合格的 P5 homepage。

---

## Concrete Polish Directives

### Directive A — Rewrite hero contract
將 hero 改為：
- posture title
- posture sentence
- why this posture exists
- compact operator-needed strip

### Directive B — Reassign surfaced items into the 3 lanes
根據真實 state 把語義搬回 lane：
- decision items 回到 Need Decision Now
- enforcement / override items 進 Platform Acting
- observed candidates 留在 Watch Next

### Directive C — Add causal trace to surfaced items
每個重要 item 補一條簡短 causal trace。

### Directive D — Enrich override/protector governance proof
新增 provenance + expiry + impact summary。

### Directive E — Reduce semantic duplication
避免：
- hero 說有 action needed
- lane 卻是空的
- context 又重講一次同一件事

首頁只能有一套主敘事。

---

## Acceptance Criteria For Polish Round

### Product acceptance
- Hero 明確表達 posture，而不是事件
- 三條 lane 與 hero 敘事一致
- operator 不需自行拼圖即可理解因果鏈
- override/protector 不再只是 visible，而是可治理、可追責
- 首頁整體噪音下降，不再像 alert wall

### Negative criteria
Polish 後的頁面仍然不能退化成：
- KPI dashboard
- governance settings page
- P4-lite manual dispatch page
- event history page

---

## Recommendation

**不建議以當前 runtime 直接部署。**

不是因為技術不通，而是因為需求收口尚未完成。

建議下一步：
- 進入 **Focused Polish Implementation**
- 只改首頁資訊架構與語義呈現
- 不重做 backend，不重做資料模型，不擴張 scope
