# GUIDE-SOLFACIL.md

**Purpose:** Solfacil 專案的標準工作指南。  
**Scope:** 包含任務鏈、Claude Code 使用方式、驗證方式、GitHub 推送節點、以及部署邊界。  
**Audience:** 代理在開始任何 Solfacil 任務前，必須先用這份文件建立工作模型。

---

# 1. Solfacil 的標準任務鏈

Solfacil 不是「想到就改、改完就測」的專案。  
它的標準流程是：

## 1.1 文件先行

**REQ → DESIGN → PLAN → REVIEW → Implementation → Runtime Acceptance → GitHub Push → 等 Alan 說「部署」 → EC2 Deploy**

### 為什麼一定是這個順序？
因為 Solfacil 任務通常同時牽涉：
- 前端頁面
- BFF API
- 真實資料 / 真實 gateway
- 本地與 EC2 的環境一致性

如果沒有先把需求、設計、實作計畫釘住，就很容易出現：
- Claude Code 直接亂猜 schema / route / column
- 頁面做出來但產品定位錯了
- 本地修通，搬到 EC2 又炸

## 1.2 每一階段要產出什麼

### REQ
定義：
- 這頁 / 這功能到底是幹嘛的
- 使用者要完成什麼任務
- acceptance criteria 是什麼
- 什麼不在這次 scope

### DESIGN
定義：
- 資料模型
- UI 結構
- 狀態模型
- API contract / query / 邏輯分層
- 關鍵行為規則

### PLAN
定義：
- 檔案級 task breakdown
- 哪些先做、哪些後做
- 驗收點怎麼切
- 哪些屬於 Phase 1 / Phase 2 / Polish / Testing

### REVIEW
定義：
- 檢查 REQ / DESIGN / PLAN 是否互相一致
- 找出 critical / warning / suggestion
- 在實作前先消掉大錯

### Implementation
定義：
- 依 PLAN 落地，不是臨場亂改方向

### Runtime Acceptance
定義：
- 用實際入口與實際資料驗證行為閉環
- 不是只看 build / grep / API

### GitHub Push
定義：
- 本地驗收通過後再 commit / push
- 讓 GitHub 成為待部署來源

### Deploy
定義：
- **只有 Alan 說「部署」後，才能動 EC2**

---

# 2. Solfacil 的環境模型

## 2.1 本地不是 demo，是 EC2 的同型 runtime

本地 Solfacil 的目標不是「方便」，而是「接近正式部署模型」。

### 本地結構
- `solfacil-db`
- `solfacil-bff`
- `solfacil-m1`
- nginx 對外入口：`http://152.42.235.155`
- service bind：`http://127.0.0.1:3100`

## 2.2 入口分工

### canonical 本地驗收入口
- **`http://152.42.235.155`**

用途：
- browser 驗證
- 產品頁驗收
- end-to-end 操作
- 與 EC2 ingress 模型對齊

### 本地 debug / service path
- **`http://127.0.0.1:3100`**

用途：
- curl
- API health
- service probing
- 後端定位

### 為什麼不能混？
因為 `127.0.0.1:3100` 是 service 視角，不是產品入口。  
它可以拿來判斷 API 活不活，不能直接拿來判斷產品是否驗收完成。

## 2.3 正式入口
- **`https://solfacil.alwayscontrol.net/`**

所有本地驗證思維，應盡量對齊這個正式入口模型。

---

# 3. Claude Code 在 Solfacil 裡的正確角色

Claude Code 是 **執行層**，不是策略層。

它適合做：
- 依明確 REQ / DESIGN / PLAN 落地實作
- 撰寫 / 修改文件
- 做結構化審查
- 按指定檔案與 acceptance 進行 coding

它**不應該**在 Solfacil 裡做：
- 沒有規格就直接憑空設計頁面
- 猜 schema / 猜 column / 猜 route
- 用模糊 prompt 直接開工
- 在第一次失敗後靠 ad-hoc 重跑碰碰運氣

## 3.1 第一次使用 Claude Code，不應該是「先試試看」

每個 Solfacil 任務第一次調用 Claude Code 時，應該先決定它要做的是哪個階段：

- REQ
- DESIGN
- PLAN
- REVIEW
- Implementation
- Focused Fix

### 為什麼？
因為如果第一次調用就用模糊目標讓它「先做做看」，最常發生的事就是：
- prompt 不完整
- Claude 猜錯專案真相
- 第一次就跑偏
- 然後又要第二次、第三次救火

**正確方式：第一次就先把任務階段和輸出物定死。**

## 3.2 Claude Code prompt 必須是工程指令，不是隨口想法

每次交給 Claude Code 的任務，都應該至少包含：

- 目標
- 相關文件路徑
- 需要修改的檔案
- 不可修改的檔案
- acceptance criteria
- 驗證方式
- 若是 review：輸出格式

### 為什麼？
Solfacil 的問題通常不是「Claude 不會寫 code」，而是：
**Claude 在不完整上下文下會往錯的方向很努力地前進。**

---

# 4. Claude Code 的啟動、監控、失敗處理

## 4.1 啟動方式

Solfacil 任務使用 Claude Code 時：
- 用 task file 寫清楚指令
- 用 PTY interactive path 啟動
- 同一任務只走一條 execution path

## 4.2 不要把「第一次失敗」當成正常流程

如果第一次 Claude Code 任務失敗，先問：
- 是 prompt 不清楚？
- 是任務階段沒切清？
- 是檔案範圍沒釘死？
- 是 acceptance 沒寫？

### 正確處理
- 先診斷失敗原因
- 再重寫任務指令
- 再重新啟動

### 不正確處理
- 直接再跑一次碰碰運氣
- 一邊跑一邊改目標
- 讓同一任務變成多條平行亂流

## 4.3 不要因為看起來慢就亂砍任務

長任務時：
- 先看 process 狀態
- 看 log 有沒有持續前進
- 看是否在讀檔、寫檔、驗證、思考
- 若懷疑卡住，先蒐集客觀證據

### 不要做的事
- 因為沉默就直接 kill
- 因為不耐煩就重啟另一條任務
- 在沒有證據下判定「它死了」

### 為什麼？
因為大文件、審查、重寫類任務本來就可能花數分鐘沉默思考。  
亂砍的代價往往比多等 2 分鐘還大。

## 4.4 任務完成或失敗，必須立即通報

一旦 Claude Code 任務：
- 成功完成
- 明確失敗
- 碰到 blocker

都要立刻回報 Alan。

### 回報至少包含
- session / 任務名稱
- 改了哪些檔
- 驗證做了哪些
- 是否還有 blocker
- 是否可進入下一步

**禁止成功不報、失敗也不報。**

---

# 5. 驗證規則

## 5.1 Claude Code 說 done，不算 done

Solfacil 驗證一定要獨立做。

### Backend / doc / review 類任務
至少要做：
- process log 驗證
- 實際檔案檢查
- 必要的 API / 輸出核對

### Frontend 任務
至少要做：
- canonical ingress browser 驗證
- 真人操作路徑
- 狀態變化驗證
- 必要時用 admin / 真資料驗證

## 5.2 什麼不算產品驗收
- 只看 build pass
- 只看 syntax OK
- 只看 API 通
- 只看 DOM 有元素
- 只看 screenshot 漂亮

## 5.3 產品完成要看行為閉環
例如一個頁面若要算完成，應該能回答：
- 使用者從哪裡進入？
- 做了哪些操作？
- 畫面狀態如何變？
- API 交互是否成立？
- 最終是否完成該頁定義的任務？

---

# 6. GitHub 與部署流程

## 6.1 本地完成後，不是立刻部署，而是先進 GitHub

標準流程：
1. 本地完成
2. 本地 runtime 驗收
3. commit
4. push GitHub
5. 回報 Alan
6. **等 Alan 說「部署」**
7. 才能動 EC2

## 6.2 為什麼 GitHub 要先於部署？
因為 GitHub 是：
- 可追溯的待部署版本
- 本地與 EC2 之間的明確邊界
- 防止「本地有改、EC2 又手動亂補」

## 6.3 EC2 部署邊界

未經 Alan 批准，禁止：
- `git pull`
- `docker restart`
- `docker compose up -d --force-recreate`
- DB / env 變更

### EC2 常規部署（已批准時）
代碼已變、env 未變：
```bash
cd /opt/solfacil && git pull && docker restart solfacil-bff solfacil-m1
```

### env / compose 變更部署（已批准時）
```bash
cd /opt/solfacil && git pull && docker compose up -d --force-recreate solfacil-m1
```

---

# 7. Solfacil 任務開始前的最小讀檔集合

每次開始 Solfacil 任務前，至少要讀：

1. **本指南**
2. `/root/.openclaw/workspace/MEMORY.md`
3. 本次任務文件：
   - REQ
   - DESIGN
   - PLAN
   - REVIEW
   - relevant daily log

### 為什麼？
- 本指南提供專案工作模型
- MEMORY.md 提供長期邊界與環境事實
- task-specific 文件提供本次任務的規格與 acceptance

---

# 8. 任務開始前必答

每次 Solfacil 任務開始，代理必須先回答：

1. 這次任務目前處於哪個階段？（REQ / DESIGN / PLAN / REVIEW / Implementation / Acceptance / Deploy）
2. 這次要交給 Claude Code 的第一個任務是什麼輸出物？
3. 本地要用哪個入口驗證？為什麼？
4. 本次完成後，要不要進 GitHub？要不要部署？
5. 若 Claude Code 第一次失敗，應該怎麼處理？
6. 若 Claude Code 長時間無輸出，應該怎麼判斷能不能介入？
7. 任務完成或失敗後，要如何回報？

---

# 9. Preflight Report Template

```markdown
## Solfacil Preflight Report

### 1. 已讀文件
- [本指南]
- [MEMORY.md]
- [task-specific 文件 1]
- [task-specific 文件 2]

### 2. 本次任務所處階段
- [REQ / DESIGN / PLAN / REVIEW / Implementation / Acceptance / Deploy]

### 3. 第一個 Claude Code 任務
- 目標輸出物：
- 相關文件：
- 不可修改範圍：
- 驗收標準：

### 4. 驗證與入口
- 本地驗收入口：
- debug path：
- 本次完成要看哪個行為閉環：

### 5. GitHub / Deploy 判定
- 完成後是否應進 GitHub：
- 是否允許部署到 EC2：

### 6. Claude Code 使用策略
- 若第一次失敗：
- 若長時間沉默：
- 若成功完成：
- 若失敗 / blocker：

### 7. 如果現在開始，我的第一步是
- [第一步]
```

---

# 10. 核心原則總結

Solfacil 的關鍵不是「寫 code」，而是**用正確順序把不確定性逐層消掉**。

所以整個指南的核心只有四句：

1. **先定階段，再調 Claude Code。**
2. **先做本地產品驗收，再進 GitHub。**
3. **沒得到 Alan 批准，不動 EC2。**
4. **完成或失敗，都要立即回報，不准沉默。**
