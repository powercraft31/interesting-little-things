# Module 6: Identity & Tenant Management — v5.23 Phase 1

> **模組版本**: v5.23
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **前版**: [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md)（Cognito 完整設計，未實作）
> **最後更新**: 2026-03-12
> **說明**: M6 Phase 1 — 本地 JWT 認證殼。不引入 Cognito，用 PostgreSQL users 表 + bcrypt + jsonwebtoken 實現最小可用登入。

---

## 1. 版本演進矩陣

| 版本 | 範圍 | 狀態 |
|------|------|------|
| v5.2 | 完整設計：Cognito + SSO + MFA + RBAC + EventBridge | 📐 設計完成，未實作 |
| **v5.23** | **Phase 1：本地 JWT 認證殼** | **🔨 本次實作** |
| v6.x+ | Phase 2：遷移至 Cognito，啟用 SSO/MFA | 📋 未來 |

### Phase 1 vs 完整設計 對照矩陣

| M6 v5.2 設計項目 | Phase 1 (v5.23) | 說明 |
|------------------|:-:|------|
| users 表 + 密碼認證 | ✅ | PostgreSQL + bcrypt（取代 Cognito User Pool） |
| JWT 簽發 / 驗證 | ✅ | 本地 jsonwebtoken（取代 Cognito Authorizer） |
| RBAC 4 角色定義 | ✅ | 沿用 v5.2 定義，存 users.role |
| org_id 隔離 | ✅ | 沿用現有 RLS，JWT payload 帶 orgId |
| 登入頁面 | ✅ | 新建 login.html |
| 登出 | ✅ | 清 localStorage + redirect |
| 管理員新增帳號 | ✅ | POST /api/users（SOLFACIL_ADMIN only） |
| Cognito User Pool | ❌ 延後 | Phase 2 |
| SSO Federation (SAML/OIDC) | ❌ 延後 | Phase 2 |
| MFA (TOTP) | ❌ 延後 | Phase 2 |
| 忘記密碼 / 重設密碼 | ❌ 延後 | Phase 2 |
| 自助註冊 | ❌ 不做 | 帳號由管理員新增 |
| EventBridge OrgProvisioned | ❌ 延後 | Phase 2 |
| Pre-Token Lambda | ❌ 延後 | Phase 2（本地無 federated user） |
| Step-Up Authentication | ❌ 延後 | Phase 2 |

---

## 2. 影響矩陣（不動 vs 改動）

| 組件 | 改動？ | 說明 |
|------|:------:|------|
| BFF handlers（get-dashboard, get-fleet 等全部） | ❌ | 只讀 header 中的 orgId/role，來源無感 |
| M1 IoT Hub (telemetry/heartbeat/fragment) | ❌ | 走 service pool，不經 BFF auth |
| M2 Schedule Generator | ❌ | cron job，service pool |
| M3 DR Dispatcher | ❌ | cron job，service pool |
| M4 Market Billing | ❌ | cron job，service pool |
| RLS policies | ❌ | 已綁 org_id，auth 只改 orgId 來源 |
| organizations 表 | ❌ | users.org_id FK 指向它 |
| assets / gateways / telemetry 表 | ❌ | 無關 |
| Docker Compose 結構 | ❌ | 無新容器，無新端口 |
| 前端 6 頁面（fleet/devices/energy/trades/hems/performance） | ❌ | 只有 data-source.js 一處出口 |
| **data-source.js getAuthHeader()** | ✅ | 硬編碼 JSON → 讀 localStorage JWT |
| **data-source.js apiGet/apiPost** | ✅ | 加 401 攔截跳轉 login |
| **導航列** | ✅ | 加登出按鈕 |
| **local-server.ts** | ✅ | 掛 auth middleware + login/users 路由 |
| **package.json** | ✅ | 加 bcryptjs + jsonwebtoken |

---

## 3. DB Schema

### 3.1 users 表

```sql
CREATE TABLE users (
  user_id       VARCHAR(50)  PRIMARY KEY DEFAULT 'u_' || substr(gen_random_uuid()::text, 1, 8),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  org_id        VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  role          VARCHAR(30)  NOT NULL DEFAULT 'ORG_VIEWER',
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('SOLFACIL_ADMIN','ORG_MANAGER','ORG_OPERATOR','ORG_VIEWER'))
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);
```

### 3.2 RBAC 角色（沿用 v5.2 §6 定義）

| role | 範圍 | 可調度 | 可管理帳號 | 可管費率 |
|------|------|:------:|:----------:|:--------:|
| SOLFACIL_ADMIN | 全平台 | ✅ | ✅ | ✅ |
| ORG_MANAGER | 單組織 | ✅ | ✅ | ✅ |
| ORG_OPERATOR | 單組織 | ✅ | ❌ | ❌ |
| ORG_VIEWER | 單組織 | ❌ | ❌ | ❌ |

Phase 1 **不做前端頁面級權限檢查**，僅靠 RLS 隔離 org_id。角色欄位預留給 Phase 2。

### 3.3 Seed 帳號

| email | org_id | role | 密碼 |
|-------|--------|------|------|
| admin@solfacil.com.br | ORG_ENERGIA_001 | SOLFACIL_ADMIN | solfacil2026 |
| alan@xuheng.com | ORG_ENERGIA_001 | SOLFACIL_ADMIN | solfacil2026 |

密碼由 seed 腳本用 bcrypt(12 rounds) hash 後 INSERT。

### 3.4 GRANT

```sql
GRANT SELECT ON users TO solfacil_app;
GRANT ALL ON users TO solfacil_service;
```

---

## 4. BFF 改動

### 4.1 新依賴

| Package | 用途 | 選型原因 |
|---------|------|----------|
| bcryptjs | 密碼 hash / verify | 純 JS，無 native binding，Docker 友好 |
| jsonwebtoken | JWT sign / verify | Node.js 生態標準 |

### 4.2 新檔案矩陣

| 檔案 | 類型 | 說明 |
|------|------|------|
| `src/bff/middleware/auth-middleware.ts` | middleware | JWT 驗證，攔截 /api/*（login 除外） |
| `src/bff/handlers/auth-login.ts` | handler | POST /api/auth/login |
| `src/bff/handlers/admin-users.ts` | handler | POST /api/users（admin only） |
| `migrations/migration_v5.23_auth.sql` | DDL | users 表 + index + grant |
| `migrations/seed_v5.23_users.ts` | seed 腳本 | bcrypt hash + INSERT（不用 SQL 硬寫 hash） |
| `test/bff/auth-login.test.ts` | 測試 | login 流程 |
| `test/bff/auth-middleware.test.ts` | 測試 | middleware 攔截 |
| `test/bff/admin-users.test.ts` | 測試 | 新增帳號 |

### 4.3 API 規格

#### POST /api/auth/login

```
Auth:     無（公開）
Request:  { "email": "string", "password": "string" }
Response: 200 { "token": "jwt...", "user": { "userId", "name", "email", "orgId", "role" } }
Error:    401 { "error": "Invalid credentials" }
```

**DB 連線決策：使用 service pool**
理由：登入時未知 orgId，無法走 app pool (RLS)。僅 SELECT users WHERE email，安全風險低。

#### POST /api/users

```
Auth:     Bearer JWT（SOLFACIL_ADMIN only）
Request:  { "email", "password", "name", "orgId", "role" }
Response: 201 { "userId", "email", "name", "orgId", "role" }
Error:    403 { "error": "Admin role required" }
          409 { "error": "Email already exists" }
```

### 4.4 Auth Middleware 邏輯

```
1. 路徑白名單：/api/auth/login 直接 next()
2. 讀 Authorization header
   - 格式 "Bearer <token>" → jwt.verify(token, JWT_SECRET)
   - 驗證失敗 → 401
3. 從 JWT payload 取 { userId, orgId, role }
4. 覆寫 req.headers.authorization = JSON.stringify({ userId, orgId, role })
5. next()
```

**關鍵：Step 4 的輸出格式跟現在的硬編碼 JSON header 完全一致。所有下游 handler 零改動。**

### 4.5 環境變數

| 變數 | 值 | 說明 |
|------|-----|------|
| JWT_SECRET | 隨機 64 字元 | docker-compose.yml 加入 solfacil-bff |
| JWT_EXPIRES_IN | 24h | 可選，預設 24h |

---

## 5. 前端改動

### 5.1 新建 login.html

- 極簡表單：email + password + 登入按鈕
- 沿用現有深色主題 CSS
- i18n 三語言（pt-BR / en / zh-CN），沿用 translations.js
- 成功 → `localStorage.setItem('solfacil_token', token)` → redirect `#fleet`
- 失敗 → 紅字提示「帳號或密碼錯誤」

### 5.2 data-source.js 改動

```javascript
// 現狀（硬編碼）
function getAuthHeader() {
  return JSON.stringify({ userId: "demo-user", orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN" });
}

// v5.23（讀 JWT）
function getAuthHeader() {
  var token = localStorage.getItem('solfacil_token');
  if (!token) { window.location.href = '/frontend-v2/login.html'; return ''; }
  return 'Bearer ' + token;
}
```

### 5.3 apiGet / apiPost 加 401 攔截

```javascript
if (res.status === 401) {
  localStorage.removeItem('solfacil_token');
  window.location.href = '/frontend-v2/login.html';
  throw new Error('Session expired');
}
```

### 5.4 導航列加登出

每頁 nav 最右加按鈕：「Sair / Logout / 登出」
onClick → `localStorage.removeItem('solfacil_token')` → redirect login.html

---

## 6. 測試矩陣

| # | 場景 | 方法 | 預期 |
|---|------|------|------|
| T1 | login 正確帳密 | POST /api/auth/login | 200 + JWT |
| T2 | login 錯誤密碼 | POST /api/auth/login | 401 |
| T3 | login 不存在 email | POST /api/auth/login | 401（同樣錯誤訊息，防枚舉） |
| T4 | login 停用帳號 (is_active=false) | POST /api/auth/login | 401 |
| T5 | 無 token 訪問 /api/dashboard | GET /api/dashboard | 401 |
| T6 | 有效 token 訪問 /api/dashboard | GET /api/dashboard | 200（數據跟現在一樣） |
| T7 | 過期 token | GET /api/dashboard | 401 |
| T8 | 偽造 token（錯誤 secret） | GET /api/dashboard | 401 |
| T9 | admin 新增帳號 | POST /api/users (SOLFACIL_ADMIN) | 201 |
| T10 | 非 admin 新增帳號 | POST /api/users (ORG_VIEWER) | 403 |
| T11 | 重複 email 新增 | POST /api/users | 409 |
| T12 | **所有現有測試** | npm test | **全 PASS（零破壞）** |

---

## 7. 實作計劃

| Step | 內容 | 文件 | 驗證 |
|------|------|------|------|
| 1 | npm install bcryptjs jsonwebtoken + @types | package.json | 安裝成功 |
| 2 | migration_v5.23_auth.sql (users 表 + index + grant) | migrations/ | psql \d users |
| 3 | seed_v5.23_users.ts (bcrypt hash + INSERT 2 帳號) | migrations/ | SELECT * FROM users |
| 4 | auth-middleware.ts | src/bff/middleware/ | T5, T6, T7, T8 |
| 5 | auth-login.ts | src/bff/handlers/ | T1, T2, T3, T4 |
| 6 | admin-users.ts | src/bff/handlers/ | T9, T10, T11 |
| 7 | local-server.ts 掛 middleware + 路由 | src/ | 整合測試 |
| 8 | login.html (i18n 三語言) | frontend-v2/ | 瀏覽器手測 |
| 9 | data-source.js 改 getAuthHeader + 401 攔截 | frontend-v2/js/ | 全鏈路：login → dashboard |
| 10 | 導航列登出按鈕 (6 頁面) | frontend-v2/ | 點擊跳回 login |
| 11 | 跑全部現有測試 | npm test | T12：全 PASS |
| 12 | git commit | — | v5.23 M6 Phase 1 |

---

## 8. EC2 部署步驟（Alan 批准後執行）

1. `git pull` 拉最新代碼
2. `docker exec solfacil-db psql` 跑 migration_v5.23_auth.sql
3. `docker exec solfacil-bff node dist/migrations/seed_v5.23_users.js` 建帳號
4. docker-compose.yml 加 `JWT_SECRET` 環境變數
5. `docker restart solfacil-bff`
6. 瀏覽器驗證 login → dashboard 全鏈路

---

## 9. Phase 2 路線圖（本次不做，僅記錄）

| 項目 | 觸發條件 |
|------|----------|
| 遷移至 Cognito User Pool | 客戶數 > 5 或需要 SSO |
| SAML/OIDC SSO Federation | 企業客戶要求 |
| MFA (TOTP) | 上線生產環境前 |
| 忘記密碼 / 重設密碼流程 | 用戶數 > 20 |
| 前端頁面級角色權限 | 確認 RBAC 需求明確後 |
| EventBridge OrgProvisioned | 多組織自動化需求 |
