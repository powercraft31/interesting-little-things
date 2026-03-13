# M6: Identity Module — JWT 認證殼 (Phase 1)

> **模組版本**: v5.23
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.22.md](./00_MASTER_ARCHITECTURE_v5.22.md) → v5.22
> **前版**: `06_IDENTITY_MODULE_v5.2.md`（Cognito + SSO + MFA — 未實作）
> **最後更新**: 2026-03-13
> **說明**: 最小可用本地 JWT 認證殼 — login、auth middleware 簽名驗證、帳號管理、前端 login.html + 登出
> **核心主題**: 外層套殼，內部零改動 — 32 個 BFF handler + 所有 cron job 行為不變

---

## v5.2 → v5.23 變更總覽

| 版本 | 變更內容 | 影響範圍 |
|------|----------|----------|
| **v5.2** | 企業級設計（Cognito + SSO + MFA + SAML），未實作 | 設計文件 only |
| **v5.23** | Phase 1 最小可用本地 JWT 認證：login endpoint、admin-users endpoint、JWT middleware 驗簽名、login.html、前端 401 攔截、登出按鈕 | 新增 7 檔案，修改 6 檔案，32 handler 零改動 |

---

## 1. 模組定位

```
┌──────────────────────────────────────────────────────────────────┐
│                       M6 Identity Module (v5.23)                  │
│                                                                   │
│   ┌─────────────┐    ┌──────────────────────────────────────┐    │
│   │  login.html  │───▶│  POST /api/auth/login               │    │
│   │  (前端)      │    │  (auth-login.ts)                     │    │
│   └──────┬──────┘    │   email+password → bcrypt verify      │    │
│          │           │   → JWT sign → { userId,orgId,role }  │    │
│          │ JWT       └──────────────────────────────────────┘    │
│          ▼                                                       │
│   ┌──────────────┐   ┌──────────────────────────────────────┐    │
│   │  前端 6 頁面  │──▶│  Auth Middleware (auth.ts)            │    │
│   │  + data-source│   │  JWT verify → overwrite req.headers  │    │
│   │  localStorage │   │  → downstream handler 零感知          │    │
│   └──────────────┘   └──────────────────────────────────────┘    │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  POST /api/users (admin-users.ts)                        │    │
│   │  SOLFACIL_ADMIN only → bcrypt hash → INSERT users +      │    │
│   │  user_org_roles                                          │    │
│   └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│  M5 BFF (32 個)  │           │  DB: users +     │
│  handler 零改動   │           │  user_org_roles  │
│  看到的仍是       │           │  (既有 schema)   │
│  raw JSON header │           └─────────────────┘
└─────────────────┘
```

### 與其他模組的關係

| 模組 | 關係 | 說明 |
|------|------|------|
| M5 BFF | **上游消費者** | 32 handler 依賴 `extractTenantContext()` 取 TenantContext；v5.23 auth middleware 驗完 JWT 後覆寫 `req.headers.authorization` 為 raw JSON，handler 零感知 |
| M1 IoT Hub | **無影響** | M1 走 MQTT，不經 BFF HTTP 路由 |
| M2 Optimization | **無影響** | Cron job，不經 HTTP |
| M3 DR Dispatcher | **無影響** | Cron job，不經 HTTP |
| M4 Market & Billing | **無影響** | Cron job，不經 HTTP |
| Shared Layer | **修改** | `verifyTenantToken()` 新增 `jsonwebtoken.verify()` 路徑 |

---

## 2. 現狀分析

### 2.1 既有 DB Schema

**users 表**（`scripts/ddl_base.sql` lines 22-30）：
```sql
CREATE TABLE IF NOT EXISTS users (
  user_id         VARCHAR(50)  PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(200),
  hashed_password VARCHAR(255),        -- ← 欄位名沿用，不改為 password_hash
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**user_org_roles 表**（`scripts/ddl_base.sql` lines 32-38）：
```sql
CREATE TABLE IF NOT EXISTS user_org_roles (
  user_id    VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  org_id     VARCHAR(50) NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)        -- junction table，支持一人多組織
);
```

**GRANT**：`solfacil_app` 和 `solfacil_service` 對 users、user_org_roles 均有 SELECT/INSERT/UPDATE/DELETE。

### 2.2 既有 Middleware

**`shared/middleware/tenant-context.ts`**（`backend/src/shared/middleware/tenant-context.ts`）：

| 函式 | 簽名 | 行號 | 行為 |
|------|------|------|------|
| `verifyTenantToken()` | `(token: string): TenantContext` | 24 | 解析 token：Raw JSON（`{` 開頭）或 JWT-style（Base64 decode payload，**不驗簽名**）；驗證 userId/orgId/role 存在且 role 合法 |
| `requireRole()` | `(ctx: TenantContext, allowedRoles: Role[]): void` | 60 | RBAC 檢查；`SOLFACIL_ADMIN` 繞過所有檢查；不符合 → throw `{ statusCode: 403, message: "Forbidden" }` |

**`bff/middleware/auth.ts`**（`backend/src/bff/middleware/auth.ts`）：

| 函式 | 簽名 | 行號 | 行為 |
|------|------|------|------|
| `extractTenantContext()` | `(event: APIGatewayProxyEventV2): TenantContext` | 19 | HTTP adapter：從 `event.headers` 取 `authorization`/`Authorization`；委派 `verifyTenantToken()` |
| `apiError()` | `(statusCode: number, message: string): APIGatewayProxyResultV2` | 28 | Lambda-style 錯誤回應：`{ statusCode, headers, body: fail(message) }` |
| `requireRole` | re-export | 13 | 從 shared 層 re-export |

### 2.3 既有前端 Auth

**`frontend-v2/js/data-source.js`**（lines 25-31）：
```javascript
function getAuthHeader() {
  return JSON.stringify({
    userId: "demo-user",
    orgId: "ORG_ENERGIA_001",
    role: "SOLFACIL_ADMIN",
  });
}
```
- `apiGet(path)`、`apiPost(path, body)`、`apiPut(path, body)` 均帶 `Authorization: getAuthHeader()`
- 無 401 攔截、無 JWT、無 localStorage

**`scripts/local-server.ts`**（lines 135-144）— demo auth middleware：
```typescript
app.use((req, _res, next) => {
  if (!req.headers.authorization) {
    req.headers.authorization = JSON.stringify({
      userId: "demo-user",
      orgId: "ORG_ENERGIA_001",
      role: "SOLFACIL_ADMIN",
    });
  }
  next();
});
```

### 2.4 既有 Type 定義

**`shared/types/auth.ts`**（`backend/src/shared/types/auth.ts`）：
```typescript
export enum Role {
  SOLFACIL_ADMIN = "SOLFACIL_ADMIN",
  ORG_MANAGER    = "ORG_MANAGER",
  ORG_OPERATOR   = "ORG_OPERATOR",
  ORG_VIEWER     = "ORG_VIEWER",
}

export interface TenantContext {
  readonly userId: string;
  readonly orgId:  string;
  readonly role:   Role;
}
```

### 2.5 既有 API Response 格式

**`shared/types/api.ts`**（`backend/src/shared/types/api.ts`）：
```typescript
export interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
  readonly timestamp: string;
}

export function ok<T>(data: T): ApiResponse<T>
export function fail(message: string): ApiResponse<null>
```

---

## 3. 新增檔案清單

### 3.1 `src/bff/handlers/auth-login.ts` — 登入端點

**路由**：`POST /api/auth/login`
**Pool**：Service Pool（`getServicePool()`）— 登入時未知 orgId，無法走 RLS
**依賴**：`bcryptjs`、`jsonwebtoken`

```typescript
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ok, fail } from "../../shared/types/api";

interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

interface LoginResponse {
  readonly token: string;
  readonly user: {
    readonly userId: string;
    readonly email: string;
    readonly name: string | null;
    readonly orgId: string;
    readonly role: string;
  };
}

export function createLoginHandler(servicePool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    // 1. 驗證 request body
    const { email, password } = req.body as LoginRequest;
    if (!email || !password) {
      res.status(400).json(fail("Email and password are required"));
      return;
    }

    // 2. 查詢 users + user_org_roles（Service Pool，BYPASSRLS）
    const result = await servicePool.query(
      `SELECT u.user_id, u.email, u.name, u.hashed_password, u.is_active,
              uor.org_id, uor.role
       FROM users u
       JOIN user_org_roles uor ON u.user_id = uor.user_id
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );

    // 3. 驗證帳號存在 + is_active
    if (result.rows.length === 0) {
      res.status(401).json(fail("Invalid email or password"));
      return;
    }
    const user = result.rows[0];
    if (!user.is_active) {
      res.status(401).json(fail("Account is disabled"));
      return;
    }

    // 4. bcrypt 比對密碼
    const match = await bcrypt.compare(password, user.hashed_password);
    if (!match) {
      res.status(401).json(fail("Invalid email or password"));
      return;
    }

    // 5. 簽發 JWT
    const jwtSecret = process.env.JWT_SECRET || "solfacil-dev-secret";
    const payload = {
      userId: user.user_id,
      orgId: user.org_id,
      role: user.role,
    };
    const token = jwt.sign(payload, jwtSecret, { expiresIn: "24h" });

    // 6. 回傳
    res.status(200).json(ok({
      token,
      user: {
        userId: user.user_id,
        email: user.email,
        name: user.name,
        orgId: user.org_id,
        role: user.role,
      },
    }));
  };
}
```

**關鍵設計**：
- 統一錯誤訊息 `"Invalid email or password"`（不洩漏帳號是否存在）
- `LIMIT 1`：Phase 1 每人只屬一個 org
- Service Pool：因為 login 時無 orgId，不能走 App Pool + RLS

### 3.2 `src/bff/handlers/admin-users.ts` — 帳號管理端點

**路由**：`POST /api/users`
**角色**：`SOLFACIL_ADMIN` only
**Pool**：Service Pool（需跨 org 寫入）

```typescript
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { ok, fail } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import { requireRole, verifyTenantToken } from "../../shared/middleware/tenant-context";

interface CreateUserRequest {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly orgId: string;
  readonly role: string;
}

interface CreateUserResponse {
  readonly userId: string;
  readonly email: string;
  readonly orgId: string;
  readonly role: string;
}

export function createAdminUsersHandler(servicePool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    // 1. RBAC（auth middleware 已驗 JWT 並覆寫 header 為 raw JSON）
    const token = req.headers.authorization as string;
    const ctx = verifyTenantToken(token);
    requireRole(ctx, [Role.SOLFACIL_ADMIN]);

    // 2. 驗證 request body
    const { email, password, name, orgId, role } = req.body as CreateUserRequest;
    if (!email || !password || !name || !orgId || !role) {
      res.status(400).json(fail("All fields required: email, password, name, orgId, role"));
      return;
    }

    // 3. 驗證 role 合法
    if (!Object.values(Role).includes(role as Role)) {
      res.status(400).json(fail(`Invalid role: ${role}`));
      return;
    }

    // 4. 生成 user_id + hash password
    const userId = `USER_${Date.now()}`;
    const hashedPassword = await bcrypt.hash(password, 12);

    // 5. INSERT（Service Pool，transaction）
    const client = await servicePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (user_id, email, name, hashed_password, is_active)
         VALUES ($1, $2, $3, $4, true)`,
        [userId, email, name, hashedPassword]
      );
      await client.query(
        `INSERT INTO user_org_roles (user_id, org_id, role)
         VALUES ($1, $2, $3)`,
        [userId, orgId, role]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // 6. 回傳
    res.status(201).json(ok({ userId, email, orgId, role }));
  };
}
```

### 3.3 `frontend-v2/login.html` — 登入頁面

- 簡潔 login form：email + password + submit
- i18n 三語言（pt-BR/en/zh-TW）沿用既有 `i18n.js` 模式
- 成功 → `localStorage.setItem("solfacil_jwt", token)` → `window.location.href = "index.html"`
- 錯誤 → 顯示錯誤訊息
- 已登入（localStorage 有 token）→ 自動跳轉 index.html

### 3.4 `migrations/migration_v5.23.sql` — Seed 數據

```sql
-- v5.23: Seed initial users (no schema changes needed)
-- users + user_org_roles tables already exist in ddl_base.sql
-- Actual seed uses the TypeScript seed script for bcrypt hash generation at runtime.
```

### 3.5 `migrations/seed_v5.23_users.ts` — Seed 腳本

```typescript
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const SEED_USERS = [
  { userId: "USER_ADMIN_001", email: "admin@solfacil.com.br", name: "Solfacil Admin",
    orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN", password: "solfacil2026" },
  { userId: "USER_ALAN_001", email: "alan@xuheng.com", name: "Alan Xu",
    orgId: "ORG_ENERGIA_001", role: "SOLFACIL_ADMIN", password: "solfacil2026" },
] as const;

export async function seedUsers(pool: Pool): Promise<void> {
  for (const u of SEED_USERS) {
    const hashedPassword = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (user_id, email, name, hashed_password, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_id) DO UPDATE SET
         hashed_password = EXCLUDED.hashed_password,
         updated_at = NOW()`,
      [u.userId, u.email, u.name, hashedPassword]
    );
    await pool.query(
      `INSERT INTO user_org_roles (user_id, org_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`,
      [u.userId, u.orgId, u.role]
    );
  }
}
```

### 3.6 `test/bff/auth-login.test.ts` — Login 流程測試

測試案例見第 12 節。

### 3.7 `test/bff/admin-users.test.ts` — 帳號管理測試

測試案例見第 12 節。

---

## 4. 修改檔案清單

### 4.1 `backend/src/shared/middleware/tenant-context.ts` — verifyTenantToken() 擴充

**當前行為**（line 32-40）：
- Raw JSON（`{` 開頭）→ `JSON.parse(token)` → 提取 userId/orgId/role
- JWT-style → `token.split(".")` → `Buffer.from(parts[1], "base64").toString()` → `JSON.parse` → 提取 userId/orgId/role
- **不驗簽名**

**修改**：

新增 `jsonwebtoken.verify()` 真實簽名驗證路徑。保留 Raw JSON 路徑供測試/開發。

```typescript
import jwt from "jsonwebtoken";

export function verifyTenantToken(token: string): TenantContext {
  // Path 1: Raw JSON（保留，供測試 + 現有 handler 在 auth middleware 覆寫後使用）
  if (token.startsWith("{")) {
    const parsed = JSON.parse(token);
    // ... existing validation ...
    return { userId, orgId, role };
  }

  // Path 2: JWT with signature verification (v5.23 NEW)
  const jwtSecret = process.env.JWT_SECRET || "solfacil-dev-secret";
  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      userId: string; orgId: string; role: string;
    };
    // ... validate userId, orgId, role existence + role legality ...
    return { userId: decoded.userId, orgId: decoded.orgId, role: decoded.role as Role };
  } catch (err) {
    throw { statusCode: 401, message: "Invalid or expired token" };
  }
}
```

**向後相容**：
- 32 個 BFF handler 不變 — auth middleware 驗完 JWT 後覆寫 header 為 raw JSON
- `verifyTenantToken()` 在 handler 層被呼叫時看到 raw JSON → 走 Path 1
- `verifyTenantToken()` 在 auth middleware 層被呼叫時看到 JWT → 走 Path 2

### 4.2 `backend/src/bff/middleware/auth.ts` — 從 Lambda adapter 改為 Express middleware

**當前**：Lambda-style adapter（`APIGatewayProxyEventV2` 入參）

**修改**：改為 Express middleware + 保留 `extractTenantContext()` 及 `apiError()` 供 handler re-use

```typescript
import { Request, Response, NextFunction } from "express";
import { verifyTenantToken } from "../../shared/middleware/tenant-context";
import { fail } from "../../shared/types/api";

// Public routes that skip JWT verification
const PUBLIC_ROUTES = ["/api/auth/login"];

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public routes
  if (PUBLIC_ROUTES.includes(req.path)) {
    next();
    return;
  }

  // Skip auth for non-API routes (static files, frontend)
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json(fail("Authorization header required"));
    return;
  }

  // Strip "Bearer " prefix if present
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  try {
    const ctx = verifyTenantToken(token);

    // KEY: overwrite authorization header with raw JSON
    // All downstream handlers see the same format as demo mode
    req.headers.authorization = JSON.stringify({
      userId: ctx.userId,
      orgId: ctx.orgId,
      role: ctx.role,
    });

    next();
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 401).json(fail(e.message ?? "Authentication failed"));
  }
}

// Keep existing exports for handler backward compatibility
export { extractTenantContext } from "./auth-compat";
export { apiError } from "./auth-compat";
export { requireRole } from "../../shared/middleware/tenant-context";
```

**關鍵設計**：
- JWT 驗完後覆寫 `req.headers.authorization = JSON.stringify({ userId, orgId, role })`
- 下游 32 handler 仍呼叫 `extractTenantContext(event)` → `verifyTenantToken(rawJSON)` → Path 1（Raw JSON parse）
- `/api/auth/login` 列入白名單

### 4.3 `backend/scripts/local-server.ts` — 掛 auth middleware + 新路由

**修改 1**：移除 demo auth middleware（lines 135-144）

**修改 2**：掛 `authMiddleware` 取代

```typescript
import { authMiddleware } from "../src/bff/middleware/auth";

// REMOVED: demo auth injection
// ADDED: JWT auth middleware (v5.23)
app.use(authMiddleware);
```

**修改 3**：新增 login + admin-users 路由

```typescript
import { createLoginHandler } from "../src/bff/handlers/auth-login";
import { createAdminUsersHandler } from "../src/bff/handlers/admin-users";

// Auth routes (v5.23)
const servicePool = getServicePool();
app.post("/api/auth/login", createLoginHandler(servicePool));
app.post("/api/users", createAdminUsersHandler(servicePool));
```

**修改 4**：前端 serving 增加 login.html 路由

```typescript
app.get("/login", (_req, res) => {
  res.sendFile(path.join(frontendDir, "login.html"));
});
app.get("/frontend-v2/login.html", (_req, res) => {
  res.sendFile(path.join(frontendDir, "login.html"));
});
```

### 4.4 `frontend-v2/js/data-source.js` — JWT auth 改造

**修改 `getAuthHeader()`**（lines 25-31）：

```javascript
function getAuthHeader() {
  const token = localStorage.getItem("solfacil_jwt");
  if (!token) {
    window.location.href = "login.html";
    return "";
  }
  return "Bearer " + token;
}
```

**修改 `apiGet()`**（lines 33-45）— 加 401 攔截：

```javascript
async function apiGet(path) {
  const res = await fetch(API_BASE + path, {
    headers: { Authorization: getAuthHeader() },
  });
  if (res.status === 401) {
    localStorage.removeItem("solfacil_jwt");
    window.location.href = "login.html";
    return;
  }
  // ... existing envelope parsing ...
}
```

**同樣修改 `apiPost()`（lines 47-64）和 `apiPut()`（lines 66-87）**：加 401 攔截。

### 4.5 `frontend-v2/index.html` — 加登出按鈕

在導航列（`sidebar-nav`，lines 30-55）底部加登出按鈕：

```html
<div class="nav-item nav-logout" id="btn-logout">
  <span class="nav-icon">🚪</span>
  <span class="nav-label">Logout</span>
</div>
```

在 `app.js` 或 inline script 加：

```javascript
document.getElementById("btn-logout")?.addEventListener("click", () => {
  localStorage.removeItem("solfacil_jwt");
  window.location.href = "login.html";
});
```

同時加 auth guard（每頁載入時檢查）：

```javascript
// Auth guard — redirect to login if no token
if (!localStorage.getItem("solfacil_jwt")) {
  window.location.href = "login.html";
}
```

### 4.6 `backend/package.json` — 新增依賴

```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.5"
  }
}
```

---

## 5. DB Schema

### 不需 ALTER — 沿用既有結構

| 表 | 狀態 | 說明 |
|----|------|------|
| `users` | **沿用** | 欄位 `hashed_password`（VARCHAR(255)），不改名 |
| `user_org_roles` | **沿用** | PK = (user_id, org_id)，Phase 1 每人僅一筆 |
| `organizations` | **沿用** | login 時 JOIN 取 org_id |

### Seed 數據

| user_id | email | org_id | role | password（明文，seed 時 bcrypt） |
|---------|-------|--------|------|------|
| USER_ADMIN_001 | admin@solfacil.com.br | ORG_ENERGIA_001 | SOLFACIL_ADMIN | solfacil2026 |
| USER_ALAN_001 | alan@xuheng.com | ORG_ENERGIA_001 | SOLFACIL_ADMIN | solfacil2026 |

### Pool 使用

| 端點 | Pool | 原因 |
|------|------|------|
| POST /api/auth/login | **Service Pool** | 登入時 orgId 未知，無法走 RLS |
| POST /api/users | **Service Pool** | 管理員操作，需跨 org 寫入 |
| 其他 32 handler | App Pool | 不變 |

---

## 6. API 定義

### 6.1 POST `/api/auth/login` — 登入

**Request**：
```json
{
  "email": "admin@solfacil.com.br",
  "password": "solfacil2026"
}
```

**Response 200**：
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "userId": "USER_ADMIN_001",
      "email": "admin@solfacil.com.br",
      "name": "Solfacil Admin",
      "orgId": "ORG_ENERGIA_001",
      "role": "SOLFACIL_ADMIN"
    }
  },
  "error": null,
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

**Response 401**（密碼錯誤 / 帳號不存在）：
```json
{
  "success": false,
  "data": null,
  "error": "Invalid email or password",
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

**Response 400**（缺少欄位）：
```json
{
  "success": false,
  "data": null,
  "error": "Email and password are required",
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

### 6.2 POST `/api/users` — 管理員添加帳號

**Headers**：`Authorization: Bearer <JWT>`（需 SOLFACIL_ADMIN）

**Request**：
```json
{
  "email": "operator@solar.com",
  "password": "initialPass123",
  "name": "João Operador",
  "orgId": "ORG_ENERGIA_001",
  "role": "ORG_OPERATOR"
}
```

**Response 201**：
```json
{
  "success": true,
  "data": {
    "userId": "USER_1710331200000",
    "email": "operator@solar.com",
    "orgId": "ORG_ENERGIA_001",
    "role": "ORG_OPERATOR"
  },
  "error": null,
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

**Response 403**（非 ADMIN）：
```json
{
  "success": false,
  "data": null,
  "error": "Forbidden",
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

---

## 7. Auth Middleware 邏輯

### 完整流程

```
Browser Request
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  Express app.use(authMiddleware)                              │
│                                                               │
│  1. req.path === "/api/auth/login"?                           │
│     YES → next() → skip auth                                  │
│                                                               │
│  2. !req.path.startsWith("/api/")?                            │
│     YES → next() → skip auth (static files)                   │
│                                                               │
│  3. req.headers.authorization 存在?                            │
│     NO → 401 "Authorization header required"                   │
│                                                               │
│  4. Strip "Bearer " prefix if present                          │
│                                                               │
│  5. verifyTenantToken(token)                                   │
│     ├─ token.startsWith("{") → Path 1: Raw JSON parse          │
│     └─ else → Path 2: jwt.verify(token, JWT_SECRET)            │
│        ├─ expired → throw { 401, "Invalid or expired token" }  │
│        ├─ bad signature → throw { 401, "..." }                 │
│        └─ valid → { userId, orgId, role }                      │
│                                                               │
│  6. Overwrite req.headers.authorization:                       │
│     = JSON.stringify({ userId, orgId, role })                  │
│     → 下游 handler 看到 raw JSON，零改動                        │
│                                                               │
│  7. next()                                                     │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  wrapHandler(handler) → makeStubEvent(req, ...)               │
│  → handler(event) → extractTenantContext(event)               │
│    → verifyTenantToken(rawJSON) → Path 1                      │
│  → 所有 32 handler 零感知                                      │
└──────────────────────────────────────────────────────────────┘
```

### 路由白名單

| 路由 | 是否需要 JWT |
|------|-------------|
| `POST /api/auth/login` | **不需要** |
| `GET /api/*`（所有其他 API） | **需要** |
| `POST /api/*`（所有其他 API） | **需要** |
| `PUT /api/*`（所有其他 API） | **需要** |
| `GET /`（前端靜態檔） | 不需要 |
| `GET /login`（login.html） | 不需要 |

---

## 8. JWT 規格

### Payload 格式

```json
{
  "userId": "USER_ADMIN_001",
  "orgId": "ORG_ENERGIA_001",
  "role": "SOLFACIL_ADMIN",
  "iat": 1710331200,
  "exp": 1710417600
}
```

- `userId`、`orgId`、`role`：與現有硬編碼 JSON header **完全一致**的 key name
- `iat`（issued at）：`jsonwebtoken` 自動加
- `exp`（expiration）：`iat + 24h`

### 簽名演算法

| 項目 | 值 |
|------|-----|
| Algorithm | HS256（HMAC-SHA256） |
| Secret | `process.env.JWT_SECRET` |
| Dev fallback | `"solfacil-dev-secret"` |
| Expiry | 24 hours |
| Refresh Token | **不做**（Phase 1） |

### Secret 管理

| 環境 | JWT_SECRET 來源 |
|------|----------------|
| Local dev | `"solfacil-dev-secret"`（code fallback） |
| EC2 部署 | 環境變數 `JWT_SECRET`（正式隨機值） |
| Phase 2 | 改用 AWS Secrets Manager 或 Cognito |

---

## 9. 前端改動

### 9.1 `data-source.js` 變更

| 函式 | 現行 | v5.23 |
|------|------|-------|
| `getAuthHeader()` | 硬編碼 raw JSON | `"Bearer " + localStorage.getItem("solfacil_jwt")` |
| `apiGet()` | 無 401 處理 | 401 → `localStorage.removeItem("solfacil_jwt")` → 跳轉 login.html |
| `apiPost()` | 無 401 處理 | 同上 |
| `apiPut()` | 無 401 處理 | 同上 |

### 9.2 `login.html` 新頁面

| 元素 | 說明 |
|------|------|
| Email input | type="email", required |
| Password input | type="password", required |
| Submit button | POST /api/auth/login |
| Error message | 紅字顯示 API 錯誤 |
| Auto redirect | 若 localStorage 有 token → 直接跳 index.html |
| i18n | 沿用 `i18n.js`，支持 pt-BR / en / zh-TW |

### 9.3 登出按鈕

在 `index.html` 導航列（`sidebar-nav`）底部新增登出 `nav-item`。

邏輯：
1. `localStorage.removeItem("solfacil_jwt")`
2. `window.location.href = "login.html"`

### 9.4 Auth Guard

因為所有 6 頁面都在 `index.html` 內（SPA 模式），只需在 `app.js` 最上方加一次：

```javascript
if (!localStorage.getItem("solfacil_jwt")) {
  window.location.href = "login.html";
}
```

---

## 10. 跨模組影響矩陣

| 模組 | 影響 | 詳情 |
|------|------|------|
| **M1 IoT Hub** | **無** | MQTT 通訊，不經 HTTP/JWT |
| **M2 Optimization Engine** | **無** | Cron job，不經 HTTP |
| **M3 DR Dispatcher** | **無** | Cron job，不經 HTTP |
| **M4 Market & Billing** | **無** | Cron job，不經 HTTP |
| **M5 BFF** | **無（handler 層）** | 32 handler 零改動；auth middleware 層改為 Express middleware |
| **M5 BFF** | **修改（middleware 層）** | `auth.ts` 從 Lambda adapter 改為 Express middleware |
| **M7 Open API** | **無** | 未上線 |
| **M8 Admin Control** | **無** | 未上線 |
| **Shared Layer** | **修改** | `tenant-context.ts` 新增 `jwt.verify()` 路徑 |
| **DB Schema** | **無** | users + user_org_roles 結構不改，僅 seed 數據 |
| **Frontend** | **修改** | data-source.js + login.html + logout + auth guard |
| **Docker Compose** | **無** | 不影響 |
| **RLS Policy** | **無** | 不影響 |

---

## 11. 測試計劃

### Unit Tests

| # | 測試案例 | 檔案 | 驗證 |
|---|---------|------|------|
| U1 | verifyTenantToken — Raw JSON 路徑 | tenant-context.test.ts | 傳入 `{"userId":"u1","orgId":"o1","role":"SOLFACIL_ADMIN"}` → 正確解析 |
| U2 | verifyTenantToken — JWT 路徑（valid） | tenant-context.test.ts | 傳入 `jwt.sign()` 產生的 token → 正確解析 |
| U3 | verifyTenantToken — JWT 過期 | tenant-context.test.ts | 傳入 expired token → throw 401 |
| U4 | verifyTenantToken — JWT 簽名錯誤 | tenant-context.test.ts | 用不同 secret sign → throw 401 |
| U5 | authMiddleware — public route skip | auth.test.ts | `req.path = "/api/auth/login"` → 直接 next() |
| U6 | authMiddleware — no auth header | auth.test.ts | 無 Authorization → 401 |
| U7 | authMiddleware — valid JWT → overwrite header | auth.test.ts | 驗完後 `req.headers.authorization` = raw JSON |
| U8 | authMiddleware — static file skip | auth.test.ts | `req.path = "/frontend-v2/index.html"` → next() |

### Integration Tests

| # | 測試案例 | 檔案 | 驗證 |
|---|---------|------|------|
| I1 | Login — 正確 email + password → 200 + JWT | auth-login.test.ts | response.data.token 可被 jwt.verify 解碼 |
| I2 | Login — 錯誤密碼 → 401 | auth-login.test.ts | `"Invalid email or password"` |
| I3 | Login — 不存在的 email → 401 | auth-login.test.ts | 同上（不洩漏帳號是否存在） |
| I4 | Login — is_active=false → 401 | auth-login.test.ts | `"Account is disabled"` |
| I5 | Login — 缺少 email/password → 400 | auth-login.test.ts | `"Email and password are required"` |
| I6 | Admin create user — ADMIN + valid body → 201 | admin-users.test.ts | response.data.userId 非空 |
| I7 | Admin create user — non-ADMIN → 403 | admin-users.test.ts | `"Forbidden"` |
| I8 | Admin create user — invalid role → 400 | admin-users.test.ts | `"Invalid role"` |
| I9 | Admin create user — duplicate email → 500/409 | admin-users.test.ts | PG unique constraint error |
| I10 | Authenticated API — valid JWT → 200 | integration.test.ts | 帶 JWT 訪問 `/api/dashboard` → 正常回數據 |
| I11 | Authenticated API — no JWT → 401 | integration.test.ts | 不帶 header → 401 |
| I12 | Authenticated API — expired JWT → 401 | integration.test.ts | 過期 token → 401 |

### Regression Tests

| # | 測試案例 | 驗證 |
|---|---------|------|
| R1 | 現有 32 handler 行為不變 | `npm test` 全部 PASS |
| R2 | Cron jobs 正常執行 | M2/M3/M4 不受影響 |

---

## 12. 決策記錄

### D1: Login endpoint 使用 Service Pool

**決策**：`POST /api/auth/login` 使用 `getServicePool()`（BYPASSRLS）
**原因**：登入時 orgId 未知，無法走 App Pool + RLS。查詢只 SELECT users + user_org_roles WHERE email。
**風險**：低。僅讀取操作，不洩漏跨 org 數據（只回傳該帳號的 org）。

### D2: JWT Secret 管理

**決策**：Phase 1 用環境變數 `JWT_SECRET`，local-server.ts 用 fallback `"solfacil-dev-secret"`
**原因**：Phase 1 簡化，不引入 Secrets Manager
**Phase 2**：遷移至 AWS Secrets Manager 或 Cognito

### D3: Token 過期時間 24 小時

**決策**：JWT expiry = 24h，不做 Refresh Token
**原因**：Phase 1 scope 限制；過期 → 前端 401 → 跳 login 頁重新登入
**Phase 2**：引入 Refresh Token 或 Cognito session

### D4: Auth middleware 覆寫 header 策略

**決策**：JWT 驗完後覆寫 `req.headers.authorization = JSON.stringify({ userId, orgId, role })`
**原因**：32 handler 全部呼叫 `extractTenantContext(event)` → `verifyTenantToken(rawJSON)` → Path 1（Raw JSON parse）。透過覆寫 header，handler 層零改動。
**權衡**：稍有 hack，但省去修改 32 個 handler 的工作量和風險。

### D5: Phase 1 不做的事項

| 不做 | 理由 | Phase |
|------|------|-------|
| 忘記密碼 / 重設密碼 | 複雜度 + 需要 email service | Phase 2 |
| 自助註冊 | 不需要，管理員加帳號 | N/A |
| MFA / SSO / SAML | Phase 2+ (Cognito) | Phase 2+ |
| 前端頁面級權限檢查 | 靠 RLS 隔離 org_id 就夠 | Phase 2 |
| Refresh Token | 單 token，過期重登 | Phase 2 |
| user_org_roles 多組織 | Phase 1 每人只屬一個 org | Phase 2 |
| Rate limiting on login | 低風險（內部系統） | Phase 2 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: Enterprise auth design (Cognito + SSO + MFA + SAML) — not implemented |
| **v5.23** | **2026-03-13** | **Phase 1 JWT Auth Shell: login endpoint + admin-users endpoint + auth middleware with JWT signature verification + login.html + frontend 401 intercept + logout button. 7 new files, 6 modified files, 32 handlers unchanged, all cron jobs unchanged** |
