# Module 6: Identity & Tenant Management (IAM)

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: Multi-tenant 架構、JWT 認證（Cognito）、RBAC 角色、SSO Federation、MFA、Token Refresh

---

## 1. 模組職責

M6 管理整個 VPP 系統的身份認證與授權：

- Multi-tenant 架構（tenantId/org_id 隔離）
- Cognito User Pool 管理
- RBAC 角色定義與鑑權
- Enterprise SSO Federation（SAML 2.0 / OIDC）
- MFA 強制執行（TOTP）
- API Gateway Authorizer
- 組織（Organization）provisioning

---

## 2. CDK Stack: `AuthStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| User Pool | Cognito User Pool | User authentication, password policy, MFA |
| User Pool Groups | Cognito Groups | RBAC role assignment (4 roles) |
| App Client (Dashboard) | Cognito App Client | Browser auth (Authorization Code Grant) |
| SAML Provider | Cognito Identity Provider (SAML 2.0) | Azure AD / Microsoft Entra federation |
| OIDC Provider | Cognito Identity Provider (OIDC) | Okta / Google Workspace federation |
| Pre-Token Lambda | Lambda (Node.js 20) | Inject `org_id` into federated user JWTs |
| Federated Mappings | DynamoDB | Map federated users → org_id + role |
| HTTP Authorizer | API GW v2 Authorizer | Cognito JWT verification for BFF routes |

### IAM Grants

```
AuthStack resources:
  ├─ Pre-Token Lambda:
  │   ├─ dynamodb:GetItem          → federated_user_mappings table
  │   └─ logs:CreateLogGroup       → CloudWatch Logs
  ├─ Cognito User Pool:
  │   └─ lambda:InvokeFunction     → Pre-Token Lambda trigger
  └─ AuthStack outputs:
      ├─ userPool, userPoolClient  → consumed by BffStack, OpenApiStack
      └─ authorizer                → consumed by BffStack
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `OrgProvisioned` | → M4 (seed org in PostgreSQL), M1 (create IoT thing group) |
| **Publishes** | `UserCreated` | → Audit log |

---

## 4. Multi-tenant 架構

### `org_id` as First-Class Citizen

- `custom:org_id` is a Cognito custom attribute (**immutable** after user creation)
- Pre-Token-Generation Lambda injects `org_id` for federated SSO users
- Every API request carries `org_id` in JWT claims
- All downstream modules enforce `org_id` filtering

### Organization Provisioning

- `POST /admin/organizations` (SOLFACIL_ADMIN only)
- Creates Cognito user group, seeds M4 PostgreSQL, creates M1 IoT thing group
- Publishes `OrgProvisioned` event

---

## 5. JWT 認證流程（Cognito User Pool）

### Cognito User Pool CDK Definition

```typescript
this.userPool = new cognito.UserPool(this, 'VppUserPool', {
  selfSignUpEnabled: false,
  signInAliases: { email: true },
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: true,
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  mfa: cognito.Mfa.REQUIRED,
  mfaSecondFactor: { sms: false, otp: true },
  customAttributes: {
    org_id: new cognito.StringAttribute({ mutable: false, minLen: 3, maxLen: 50 }),
  },
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// Advanced Security
const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
cfnUserPool.userPoolAddOns = { advancedSecurityMode: 'ENFORCED' };
```

### App Client (Dashboard)

```typescript
this.userPoolClient = this.userPool.addClient('DashboardClient', {
  authFlows: { userPassword: true, userSrp: true },
  oAuth: {
    flows: { authorizationCodeGrant: true },
    scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
    callbackUrls: ['http://localhost:3000/callback', 'https://vpp.solfacil.com.br/callback'],
    logoutUrls: ['http://localhost:3000/', 'https://vpp.solfacil.com.br/'],
  },
  idTokenValidity: cdk.Duration.hours(1),
  accessTokenValidity: cdk.Duration.hours(1),
  refreshTokenValidity: cdk.Duration.days(30),
});
```

### API Gateway Authorizer

```typescript
this.authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', this.userPool, {
  userPoolClients: [this.userPoolClient],
  identitySource: '$request.header.Authorization',
});
```

---

## 6. RBAC 角色定義

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     SOLFACIL_ADMIN                          │
│  Platform-level superuser. Can see ALL organizations.      │
│  custom:org_id = "SOLFACIL"                                │
│  Intended for: SOLFACIL internal operations team           │
├─────────────────────────────────────────────────────────────┤
│                     ORG_MANAGER                             │
│  Organization-level admin. Full control over their own org.│
│  Intended for: Enterprise client's energy manager          │
├─────────────────────────────────────────────────────────────┤
│                     ORG_OPERATOR                            │
│  Can dispatch commands and monitor within their org.       │
│  Intended for: Field technicians, dispatch operators       │
├─────────────────────────────────────────────────────────────┤
│                     ORG_VIEWER                              │
│  Read-only access to dashboards and reports within org.    │
│  Intended for: Executives, auditors, read-only stakeholders│
└─────────────────────────────────────────────────────────────┘
```

### Permission Matrix

| Permission | SOLFACIL_ADMIN | ORG_MANAGER | ORG_OPERATOR | ORG_VIEWER |
|------------|:-:|:-:|:-:|:-:|
| View dashboard (own org) | all orgs | own org | own org | own org |
| View assets | all orgs | own org | own org | own org |
| View trades & revenue | all orgs | own org | own org | own org |
| Dispatch mode change | all orgs | own org | own org | - |
| Trigger DR test | all orgs | own org | own org | - |
| Manage tariff config | all orgs | own org | - | - |
| Manage users in org | all orgs | own org | - | - |
| Create / delete organizations | yes | - | - | - |
| View audit logs (cross-org) | yes | - | - | - |

---

## 7. Enterprise SSO Federation

### SAML 2.0 (Azure AD / Microsoft Entra ID)

```typescript
const azureAdProvider = new cognito.UserPoolIdentityProviderSaml(this, 'AzureAdSamlProvider', {
  userPool: this.userPool,
  name: 'AzureAD',
  metadata: cognito.UserPoolIdentityProviderSamlMetadata.url(
    'https://login.microsoftonline.com/<tenant-id>/federationmetadata/...'
  ),
  attributeMapping: {
    email: cognito.ProviderAttribute.other('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'),
  },
  idpSignout: true,
});
```

### OIDC (Okta / Google Workspace)

```typescript
const oktaProvider = new cognito.UserPoolIdentityProviderOidc(this, 'OktaOidcProvider', {
  userPool: this.userPool,
  name: 'Okta',
  clientId: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-id'),
  clientSecret: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-secret'),
  issuerUrl: 'https://your-domain.okta.com/oauth2/default',
  scopes: ['openid', 'email', 'profile', 'groups'],
});
```

### Federated User Mapping (Pre-Token-Generation Lambda)

```typescript
export const handler = async (event: CognitoUserPoolTriggerEvent) => {
  const email = event.request.userAttributes.email;
  const mapping = await dynamodb.get({
    TableName: 'federated_user_mappings',
    Key: { email },
  }).promise();

  if (mapping.Item) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: { 'custom:org_id': mapping.Item.org_id },
      groupOverrideDetails: { groupsToOverride: [mapping.Item.role] },
    };
  }
  return event;
};
```

**DynamoDB: `federated_user_mappings`**

| PK (email) | org_id | role | idp_name | provisioned_at |
|------------|--------|------|----------|----------------|
| joao@energiacorp.com.br | ORG_ENERGIA_001 | ORG_MANAGER | AzureAD | 2026-02-20 |
| maria@solarbr.com.br | ORG_SOLARBR_002 | ORG_OPERATOR | Okta | 2026-02-20 |

### SSO Fallback Strategy

1. **Detection:** `SAML_PROVIDER_ERROR` or OIDC token exchange failure
2. **Fallback:** Redirect to standard Cognito login page
3. **Emergency:** ORG_MANAGER users have local Cognito passwords as break-glass
4. **Monitoring:** CloudWatch alarm on `FederationErrors` metric → SNS notification

---

## 8. Multi-Factor Authentication (MFA)

| Role | MFA Requirement | Method | Rationale |
|------|----------------|--------|-----------|
| SOLFACIL_ADMIN | **Mandatory** | TOTP | Platform-wide access; highest privilege |
| ORG_MANAGER | **Mandatory** | TOTP | Can dispatch and manage users |
| ORG_OPERATOR | **Mandatory** | TOTP | Can dispatch mode changes to physical assets |
| ORG_VIEWER | Optional | TOTP | Read-only; lower compromise impact |

**TOTP over SMS:** Offline (no SIM-swap risk), free, works without cell signal, meets NIST SP 800-63B Level 2.

---

## 9. Token Refresh 流程

| Token | Validity | Refresh |
|-------|----------|---------|
| ID Token | 1 hour | Via Refresh Token |
| Access Token | 1 hour | Via Refresh Token |
| Refresh Token | 30 days | Re-authentication required after expiry |

**Step-Up Authentication:** Sensitive operations (dispatch, user management) require `auth_time` within 15 minutes.

---

## 10. RLS (Row-Level Security) 策略

All M4 PostgreSQL tables enforce RLS:

```sql
-- Lambda middleware sets session variable
SET app.current_org_id = '{org_id from JWT}';

-- RLS policy on every table
CREATE POLICY tenant_isolation ON {table}
  USING (org_id = current_setting('app.current_org_id', true));

-- SOLFACIL_ADMIN: DB role with BYPASSRLS
```

---

## 11. Cognito CLI & Test Users

### CLI Quick Reference

```bash
# Create user
aws cognito-idp admin-create-user \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --user-attributes Name=email,Value=joao@energiacorp.com.br \
    Name=email_verified,Value=true \
    Name=custom:org_id,Value=ORG_ENERGIA_001 \
  --temporary-password "TempPass123!"

# Add to role group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --group-name ORG_MANAGER

# List users in org
aws cognito-idp list-users \
  --user-pool-id sa-east-1_XXXXXXX \
  --filter 'custom:org_id = "ORG_ENERGIA_001"'
```

### Test User Seed Data

| Email | Org | Role | Purpose |
|-------|-----|------|---------|
| `admin@solfacil.com.br` | SOLFACIL | SOLFACIL_ADMIN | Platform admin |
| `gerente@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_MANAGER | Org manager |
| `operador@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_OPERATOR | Dispatch operator |
| `auditor@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_VIEWER | Read-only viewer |
| `gerente@solarbr.com.br` | ORG_SOLARBR_002 | ORG_MANAGER | Org manager |
| `operador@solarbr.com.br` | ORG_SOLARBR_002 | ORG_OPERATOR | Dispatch operator |

---

## 12. Lambda Handlers

```
src/auth/
├── triggers/
│   └── pre-token-generation.ts   # Cognito trigger: inject org_id for federated users
├── handlers/
│   ├── provision-org.ts          # POST /admin/organizations
│   ├── create-user.ts            # POST /users
│   └── list-users.ts             # GET /users
└── __tests__/
    ├── pre-token-generation.test.ts
    └── provision-org.test.ts
```

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M8 (Admin Control) | AppConfig `rbac-policies` 讀取動態權限矩陣 |
| **被依賴** | M5 (BFF) | Cognito Authorizer、JWT 驗證 |
| **被依賴** | M7 (Open API) | Cognito Resource Server、Machine Clients |
| **被依賴** | M4 (Market & Billing) | 發佈 `OrgProvisioned` → seed PostgreSQL |
| **被依賴** | M1 (IoT Hub) | 發佈 `OrgProvisioned` → create IoT thing group |
