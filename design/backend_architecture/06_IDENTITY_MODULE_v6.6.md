# Module 6: Identity Module (M6)

> **Module Version**: v6.6
> **Git HEAD**: `4ec191a`
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.6.md](./00_MASTER_ARCHITECTURE_v6.6.md)
> **Last Updated**: 2026-03-31
> **Description**: JWT-based authentication shell -- no standalone identity service; auth is handled by BFF middleware + shared layer
> (**说明**: 基于JWT的认证壳 -- 无独立身份服务；认证由BFF中间件+共享层处理)

---

## 1. Module Overview

M6 is a lightweight authentication shell rather than a standalone identity service. It provides:

1. **Login endpoint** (`POST /api/auth/login`) -- bcrypt password verification, JWT signing, token return
   (登录端点：bcrypt密码验证、JWT签发、返回token)

2. **Auth middleware** (`authMiddleware`) -- JWT validation on all `/api/*` routes, transparent header rewriting for backward compatibility with 45 existing BFF handlers
   (认证中间件：对所有/api/*路由进行JWT验证，透明重写header以兼容现有45个BFF handler)

3. **User management** (`POST /api/users`) -- SOLFACIL_ADMIN-only user creation
   (用户管理：仅SOLFACIL_ADMIN可创建用户)

4. **Role-based access control** -- 4-level role hierarchy enforced via shared `requireRole()`
   (角色访问控制：4级角色层级)

There is no Cognito, no SSO, no MFA -- this is Phase 1 minimal viable auth.
(无Cognito、无SSO、无MFA -- 这是Phase 1最小可用认证)

### Source Files

```
src/bff/handlers/
├── auth-login.ts               # POST /api/auth/login — JWT login handler
└── admin-users.ts              # POST /api/users — admin user creation

src/bff/middleware/
└── auth.ts                     # Express JWT auth middleware + backward-compat exports

src/shared/middleware/
└── tenant-context.ts           # Pure tenant token verification (JWT + raw JSON paths)

src/shared/types/
└── auth.ts                     # Role enum + TenantContext interface
```

---

## 2. Login Flow (登录流程)

**Route**: `POST /api/auth/login`
**Handler**: `auth-login.ts` -> `createLoginHandler(servicePool)`
**Pool**: Service Pool (`getServicePool()`) -- because `orgId` is unknown at login time, cannot use App Pool + RLS
(使用Service Pool因为登录时orgId未知，无法走RLS)

### 2.1 Request

```json
{
  "email": "admin@solfacil.com.br",
  "password": "solfacil2026"
}
```

### 2.2 Processing Steps

1. **Validate** `email` and `password` present -> 400 if missing
2. **Query** `users JOIN user_org_roles` by email (Service Pool, BYPASSRLS):
   ```sql
   SELECT u.user_id, u.email, u.name, u.hashed_password, u.is_active,
          uor.org_id, uor.role
   FROM users u
   JOIN user_org_roles uor ON u.user_id = uor.user_id
   WHERE u.email = $1
   LIMIT 1
   ```
3. **Check** user exists -> 401 `"Invalid email or password"` (不泄漏账号是否存在)
4. **Check** `is_active` -> 401 `"Account is disabled"`
5. **bcrypt compare** password against `hashed_password` -> 401 `"Invalid email or password"`
6. **Sign JWT** with `HS256`, payload `{ userId, orgId, role }`, expires in 24h
7. **Return** token + user object

### 2.3 Response

**200 OK**:
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
  "timestamp": "..."
}
```

**401**: `"Invalid email or password"` | `"Account is disabled"`
**400**: `"Email and password are required"`

---

## 3. JWT Token (JWT令牌)

### 3.1 Payload

```json
{
  "userId": "USER_ADMIN_001",
  "orgId": "ORG_ENERGIA_001",
  "role": "SOLFACIL_ADMIN",
  "iat": 1710331200,
  "exp": 1710417600
}
```

Key names (`userId`, `orgId`, `role`) match the existing hardcoded JSON header format exactly, enabling zero-change backward compatibility.
(key名称与现有硬编码JSON header完全一致，实现零改动向后兼容)

### 3.2 Signing Configuration

| Parameter | Value |
|-----------|-------|
| Algorithm | HS256 (HMAC-SHA256) |
| Secret | `process.env.JWT_SECRET` |
| Dev fallback | `"solfacil-dev-secret"` |
| Expiry | 24 hours |
| Refresh Token | **Not implemented** (Phase 1) |

### 3.3 Verification: `verifyTenantToken()`

Located in `shared/middleware/tenant-context.ts`. Supports two token formats:

**Path 1: Raw JSON** (token starts with `{`):
- `JSON.parse(token)` -> extract `userId`, `orgId`, `role`
- Validates all three fields present and role is valid
- Used by downstream handlers after auth middleware rewrites the header
  (下游handler在auth中间件重写header后使用此路径)

**Path 2: JWT** (all other tokens):
- Strips `Bearer ` prefix if present
- `jwt.verify(token, jwtSecret)` with HS256
- Validates decoded `userId`, `orgId`, `role`
- Throws `{ statusCode: 401, message: "Invalid or expired token" }` on failure

---

## 4. Role Hierarchy (角色层级)

```typescript
export enum Role {
  SOLFACIL_ADMIN = "SOLFACIL_ADMIN",
  ORG_MANAGER    = "ORG_MANAGER",
  ORG_OPERATOR   = "ORG_OPERATOR",
  ORG_VIEWER     = "ORG_VIEWER",
}
```

**Hierarchy** (highest to lowest):

| Role | Level | Description |
|------|-------|-------------|
| `SOLFACIL_ADMIN` | 1 (highest) | Platform admin -- bypasses ALL role checks (平台管理员 -- 绕过所有角色检查) |
| `ORG_MANAGER` | 2 | Organization manager (组织管理员) |
| `ORG_OPERATOR` | 3 | Organization operator (组织操作员) |
| `ORG_VIEWER` | 4 (lowest) | Read-only viewer (只读查看者) |

**RBAC enforcement** via `requireRole(ctx, allowedRoles)`:
- `SOLFACIL_ADMIN` always passes (always returns without throwing)
- Other roles checked against `allowedRoles` array
- Throws `{ statusCode: 403, message: "Forbidden" }` on failure

---

## 5. Auth Middleware Flow (认证中间件流程)

Located in `bff/middleware/auth.ts`:

```
Browser Request
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│  Express app.use(authMiddleware)                               │
│                                                                │
│  1. req.path === "/api/auth/login"?                            │
│     YES → next() (skip auth — public route)                    │
│                                                                │
│  2. !req.path.startsWith("/api/")?                             │
│     YES → next() (skip auth — static files)                    │
│                                                                │
│  3. No Authorization header? → 401                             │
│                                                                │
│  4. Strip "Bearer " prefix if present                          │
│                                                                │
│  5. verifyTenantToken(token)                                   │
│     ├─ token.startsWith("{") → Path 1: Raw JSON parse          │
│     └─ else → Path 2: jwt.verify(token, JWT_SECRET)            │
│                                                                │
│  6. Overwrite req.headers.authorization with raw JSON:          │
│     = JSON.stringify({ userId, orgId, role })                  │
│     → Downstream handlers see raw JSON, zero changes needed    │
│       (下游handler看到raw JSON，零改动)                          │
│                                                                │
│  7. next()                                                     │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
  45 existing BFF handlers — unchanged (零改动)
```

**Public routes** (skip JWT): `["/api/auth/login"]`

**Key design**: After JWT verification, the middleware overwrites `req.headers.authorization` with raw JSON `{ userId, orgId, role }`. All 45 existing BFF handlers call `extractTenantContext(event)` -> `verifyTenantToken(rawJSON)` -> Path 1. This eliminates the need to modify any handler.
(关键设计：JWT验证后，中间件将authorization header重写为raw JSON。所有45个现有handler无需修改)

---

## 6. User Management (用户管理)

**Route**: `POST /api/users`
**Handler**: `admin-users.ts` -> `createAdminUsersHandler(servicePool)`
**Access**: `SOLFACIL_ADMIN` only
**Pool**: Service Pool (cross-org write capability)

### 6.1 Request

```json
{
  "email": "operator@solar.com",
  "password": "initialPass123",
  "name": "Joao Operador",
  "orgId": "ORG_ENERGIA_001",
  "role": "ORG_OPERATOR"
}
```

### 6.2 Processing Steps

1. **RBAC check**: Extract token from header -> `verifyTenantToken()` -> `requireRole([SOLFACIL_ADMIN])`
2. **Validate** all 5 fields present -> 400 if missing
3. **Validate** role is a valid `Role` enum value -> 400 `"Invalid role: ..."`
4. **Tenant scope check**: `orgId !== ctx.orgId` -> 403 `"Cannot create users outside your own organization"`
   (租户范围检查：管理员只能在自己的组织内创建用户)
5. **Generate** `user_id = USER_{timestamp}`
6. **Hash** password with `bcrypt.hash(password, 12)` (cost factor 12)
7. **Transaction**: INSERT `users` + INSERT `user_org_roles` -> COMMIT
8. **Return** 201 with `{ userId, email, orgId, role }`

### 6.3 Response Codes

| Code | Condition |
|------|-----------|
| 201 | User created successfully |
| 400 | Missing fields or invalid role |
| 401 | Invalid or expired token |
| 403 | Non-admin role or cross-org attempt |
| 500 | Internal error (e.g., duplicate email constraint) |

---

## 7. DB Tables (数据库表)

### 7.1 `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id         VARCHAR(50)  PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(200),
  hashed_password VARCHAR(255),
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 7.2 `user_org_roles`

```sql
CREATE TABLE IF NOT EXISTS user_org_roles (
  user_id    VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  org_id     VARCHAR(50) NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)  -- junction table, supports multi-org in Phase 2
);
```

**Current limitation**: Phase 1 uses `LIMIT 1` in login query, so each user belongs to only one organization. The schema supports multi-org via the composite PK.
(当前限制：Phase 1登录查询使用LIMIT 1，每用户只属一个组织。Schema通过复合主键支持多组织)

### 7.3 Pool Assignment

| Endpoint | Pool | Reason |
|----------|------|--------|
| `POST /api/auth/login` | **Service Pool** | orgId unknown at login time (登录时orgId未知) |
| `POST /api/users` | **Service Pool** | Admin needs cross-org write (需跨组织写入) |
| All 45 BFF handlers | App Pool | Unchanged, RLS-scoped (不变，RLS限定) |

---

## 8. RLS Integration (行级安全集成)

The Identity Module interacts with RLS through the shared `queryWithOrg()` helper:

```typescript
// In shared/db.ts
export async function queryWithOrg<T>(sql, params, orgId) {
  // SET LOCAL app.current_org_id = orgId
  // Then execute the query within RLS context
}
```

- **Login** and **user creation** use Service Pool (BYPASSRLS) because they operate before/across org boundaries
- **All downstream API handlers** use App Pool with `queryWithOrg()`, which sets `app.current_org_id` via `SET LOCAL` for PostgreSQL RLS policy evaluation
  (所有下游API handler使用App Pool搭配queryWithOrg()，通过SET LOCAL设置RLS上下文)

---

## 9. Module Dependencies (模组依赖)

| Direction | Module | Description |
|-----------|--------|-------------|
| **Depended on by** | M5 (BFF) | 45 handlers depend on `extractTenantContext()` -> `verifyTenantToken()` |
| **Depended on by** | M4 (Market & Billing) | Imports `verifyTenantToken()` directly |
| **Depended on by** | M8 (Admin Control) | Imports `verifyTenantToken()` directly |
| **No impact** | M1 (IoT Hub) | MQTT communication, not HTTP |
| **No impact** | M2 (Optimization) | Cron jobs, not HTTP |
| **No impact** | M3 (DR Dispatcher) | Cron jobs, not HTTP |

---

## 10. Phase 1 Limitations (Phase 1未实现项目)

| Not Implemented | Reason | Target Phase |
|----------------|--------|--------------|
| Password reset | Needs email service | Phase 2 |
| Self-registration | Not needed; admin creates accounts | N/A |
| MFA / SSO / SAML | Complexity; use Cognito | Phase 2+ |
| Refresh Token | Single token; re-login on expiry | Phase 2 |
| Page-level RBAC in frontend | RLS isolates org_id sufficiently | Phase 2 |
| Multi-org per user | Schema supports it; login uses LIMIT 1 | Phase 2 |
| Rate limiting on login | Low risk (internal system) | Phase 2 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: Enterprise auth design (Cognito + SSO + MFA + SAML) -- not implemented |
| v5.23 | 2026-03-13 | Phase 1 JWT Auth Shell: login endpoint, admin-users endpoint, auth middleware with JWT signature verification, login.html, frontend 401 intercept, logout button |
| **v6.6** | **2026-03-31** | **Code-aligned rewrite from source: document actual verifyTenantToken() dual-path logic, tenant scope enforcement in admin-users, pool assignment rationale, RLS integration via queryWithOrg()** |
