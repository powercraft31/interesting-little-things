# Solfacil Web Auth Boundary Review

Date: 2026-04-10  
Status: Phase 0 design freeze draft  
Scope: Solfacil Web login, browser session model, API auth, SSE auth, proxy boundary, runtime secret handling, baseline auth hardening

---

## 0. Executive Summary

Current Solfacil Web authentication is not a single coherent browser session model. It is a mixed model assembled from:

- `localStorage` bearer token for normal API calls
- HttpOnly cookie for SSE and secondary auth input
- BFF middleware that accepts either `Authorization` or cookie
- runtime secret behavior that can fall back to a development default

This creates structural problems rather than isolated defects:

1. session truth is split across multiple places
2. normal API and SSE use different authentication channels
3. risk surfaces stack instead of converge
4. rejection behavior is not consistently fail-closed
5. security responsibilities are not clearly assigned across frontend, BFF, Nginx, and runtime config

Recommended direction:

- adopt a single Cookie-first browser session model
- engineering target for this remediation cycle: **JWT only in HttpOnly Secure cookie**, remove browser-side persistent bearer token
- long-term target: preserve upgrade path to **server-side session**
- default to **same-origin** for the web admin surface
- enforce **secret fail-fast**, stable CORS rejection, unified auth semantics, proxy-level security headers, and login abuse controls

This document is the design baseline before implementation.

---

## 1. Purpose

This document answers:

1. how the system actually authenticates today
2. where session truth currently lives
3. what the real structural problems are
4. what the target architecture should be
5. what is in scope and out of scope for this remediation
6. how implementation should be staged, validated, and delegated

This document does **not** provide final code patches. It is the design and execution baseline for the implementation phase.

---

## 2. Current System Boundary

Authentication currently spans five component areas.

### 2.1 Browser Frontend
Responsibilities today:
- render login page
- persist local browser state
- make normal API requests
- establish SSE connection
- trigger logout flow

Relevant files:
- `frontend-v2/login.html`
- `frontend-v2/js/data-source.js`
- `frontend-v2/js/app.js`
- `frontend-v2/js/p2-devices.js`

### 2.2 BFF / Express
Responsibilities today:
- login
- logout
- JWT validation
- `/api/*` auth middleware
- SSE endpoint
- CORS behavior

Relevant files:
- `backend/src/bff/handlers/auth-login.ts`
- `backend/src/bff/middleware/auth.ts`
- `backend/src/bff/handlers/sse-events.ts`
- `backend/src/shared/middleware/tenant-context.ts`
- `backend/scripts/local-server.ts`

### 2.3 Reverse Proxy / Nginx
Responsibilities today:
- public routing
- `/api/` proxying
- `/solfacil/` proxying
- part of transport and response header boundary

### 2.4 Runtime Config / Secret
Responsibilities today:
- `JWT_SECRET`
- DB connection strings
- environment-dependent cookie behavior
- dev vs prod separation

### 2.5 Database
Responsibilities today:
- user identity data
- password hash storage
- user and org/role mapping

---

## 3. Current State Flow Model

### 3.1 Current State Overview

```text
Browser
  -> login.html / app.js / data-source.js / p2-devices.js
  -> Nginx
  -> BFF / Express
  -> Postgres
```

### 3.2 Login Flow, Current State

```text
Browser -> GET /login.html
        -> login.html checks localStorage["solfacil_jwt"]
           -> if exists, redirect /index.html
           -> if missing, render login form

Browser -> POST /api/auth/login { email, password }

BFF auth-login.ts
  1. query users + user_org_roles
  2. bcrypt.compare()
  3. jwt.sign({ userId, orgId, role })
  4. Set-Cookie: solfacil_jwt=...; HttpOnly; SameSite=Lax; Path=/
  5. return JSON { token, user }

Frontend login.html
  -> localStorage.setItem("solfacil_jwt", token)
  -> redirect /index.html
```

### 3.3 Normal API Flow, Current State

```text
Frontend
  -> read localStorage["solfacil_jwt"]
  -> Authorization: Bearer <token>
  -> call /api/*

BFF authMiddleware
  -> try req.headers.authorization
  -> if absent, try cookie "solfacil_jwt"
  -> verifyTenantToken()
  -> normalize claims
  -> allow request
```

### 3.4 SSE Flow, Current State

```text
Frontend
  -> new EventSource("/api/events")

Browser
  -> automatically sends cookie

BFF authMiddleware
  -> reads cookie "solfacil_jwt"
  -> validates token
  -> enters sse-events.ts
  -> establishes long-lived stream
```

### 3.5 Logout Flow, Current State

```text
Frontend
  -> POST /api/auth/logout

BFF
  -> clearCookie("solfacil_jwt")

Frontend finally
  -> localStorage.removeItem("solfacil_jwt")
  -> redirect /login.html
```

---

## 4. Current State Structural Assessment

The core issue is not a few exposed flaws. The core issue is that the authentication boundary was never fully converged into one browser session model.

### 4.1 Problem A, No Single Session Truth
Session state currently exists in:
- browser `localStorage`
- browser cookie jar
- BFF middleware that accepts both
- runtime secret that anchors trust

Consequences:
- logout requires dual cleanup
- API and SSE do not share one source of truth
- permission refresh and forced logout become awkward
- token rotation or invalidation becomes harder

### 4.2 Problem B, Authentication Channel Split
Current channels:
- normal API uses `Authorization: Bearer`
- SSE uses cookie

Consequences:
- two auth semantics for one web app
- higher debugging complexity
- duplicated risk analysis
- session behavior becomes inconsistent across flows

### 4.3 Problem C, Risk Model Stacks Instead of Converges
Using `localStorage` introduces larger XSS consequence radius.  
Using cookie auth requires proper SameSite, Secure, CSRF, and origin discipline.  
Current model keeps both.

Consequences:
- two risk classes instead of one controlled model
- higher implementation and operational burden

### 4.4 Problem D, Boundary Does Not Fail Closed
Observed from code and external behavior:
- non-whitelist `Origin` can trigger `500` rather than stable rejection
- `JWT_SECRET` can fall back to a development default in auth paths
- auth cookie is not explicitly `Secure`
- rejection behavior is not consistently modeled as a normal control path

Consequences:
- the system prefers “continue running” over “refuse unsafe startup or unsafe request handling”

### 4.5 Problem E, Security Responsibility Is Not Clearly Assigned
Current state shows no fully unified responsibility split for:
- frontend auth behavior
- BFF auth behavior
- Nginx response boundary
- runtime secret governance

Consequences:
- security controls are scattered
- policy becomes accidental
- future changes risk regression because ownership is unclear

---

## 5. Current State Evidence Summary

The following are confirmed from code review:

### 5.1 localStorage token use
Confirmed in:
- `frontend-v2/login.html`
- `frontend-v2/js/data-source.js`
- `frontend-v2/js/app.js`

Meaning:
- browser JS is currently the main bearer token carrier for normal API calls

### 5.2 Cookie-based SSE path
Confirmed in:
- `frontend-v2/js/p2-devices.js`
- `backend/src/bff/handlers/sse-events.ts`
- `backend/src/bff/middleware/auth.ts`

Meaning:
- SSE depends on cookie-backed auth path

### 5.3 CORS rejection path can become error path
Confirmed in:
- `backend/scripts/local-server.ts`

Meaning:
- non-whitelist origin handling is implemented in a way that can produce error behavior rather than explicit policy rejection

### 5.4 Secret fallback exists in auth trust root
Confirmed in:
- `backend/src/bff/handlers/auth-login.ts`
- `backend/src/shared/middleware/tenant-context.ts`

Meaning:
- production safety depends on external environment discipline, not only code discipline

### 5.5 Auth cookie lacks explicit Secure
Confirmed in:
- `backend/src/bff/handlers/auth-login.ts`

Meaning:
- HTTPS-only trust boundary is not fully enforced at cookie level

---

## 6. Target State Principles

The following principles define the target architecture.

### Principle 1
The browser admin surface must have **one primary authentication model**.

### Principle 2
Browser JavaScript should **not** persist high-value auth credentials long term.

### Principle 3
Critical trust prerequisites such as secret injection must **fail fast** if missing.

### Principle 4
The web admin interface should be **same-origin first**. Cross-origin access is not a default product capability.

### Principle 5
Security responsibilities must be explicitly assigned across frontend, BFF, proxy, and runtime layers.

---

## 7. Authentication Model Options

### Option A, Keep localStorage plus Bearer as main model
Form:
- frontend persists token
- normal API uses `Authorization`
- SSE continues as cookie exception

Pros:
- lowest short-term change

Cons:
- keeps split model alive
- keeps JS-readable token alive
- keeps API and SSE on different semantics

Decision:
- **Rejected as target state**

### Option B, JWT in HttpOnly Secure Cookie only
Form:
- service issues signed JWT in cookie
- frontend JS no longer stores bearer token
- normal API and SSE both use browser cookie path

Pros:
- unifies browser auth channel
- removes persistent JS-readable auth token
- feasible migration target

Cons:
- still a self-contained token model, not fully server-governed session
- revocation and immediate privilege change handling remain weaker than server-side session
- requires proper CSRF/origin discipline

Decision:
- **Accepted as engineering target for this remediation cycle**

### Option C, Server-side Session plus HttpOnly Secure Cookie
Form:
- browser receives opaque session cookie
- server holds session state
- API and SSE both use same server-governed session

Pros:
- strongest session control
- better revocation
- better forced logout and immediate permission change handling
- best fit for high-value browser admin system

Cons:
- more complex rollout
- requires session store and lifecycle management

Decision:
- **Accepted as long-term preferred target**, but not required for the first remediation cycle

---

## 8. Recommended Target Architecture

### 8.1 Engineering Target for This Cycle
Adopt:
- **Cookie-first browser session architecture**
- **JWT only in HttpOnly Secure cookie**
- remove persistent browser bearer token
- unify normal API and SSE behind the same cookie-backed auth path

### 8.2 Long-term Architecture Direction
Preserve upgrade path to:
- **server-side session plus HttpOnly Secure cookie**

### 8.3 Why This Is the Recommended Path
Because Solfacil is a browser-based admin surface, not a general public third-party API product. For this class of system:
- browser should not own auth token persistence
- SSE should not remain a special auth exception
- session truth should not be split across frontend storage and cookie state

---

## 9. Target State Flow Model

### 9.1 Login Flow, Target State

```text
Browser -> GET /login
        -> render login page
        -> do not depend on localStorage to decide login state

Browser -> POST /api/auth/login
        -> same-origin credentials flow

BFF
  -> validate identity
  -> issue auth cookie
  -> optionally return minimal user/session info
  -> do not require frontend to persist bearer token

Browser
  -> navigate to app
```

### 9.2 Normal API Flow, Target State

```text
Frontend -> fetch("/api/...", { credentials: "same-origin" })
         -> browser auto-sends auth cookie
         -> BFF validates cookie-backed session/auth
```

### 9.3 SSE Flow, Target State

```text
Frontend -> new EventSource("/api/events")
         -> browser auto-sends same auth cookie
         -> BFF validates same auth/session model
```

### 9.4 Logout Flow, Target State

```text
Frontend -> POST /api/auth/logout
BFF      -> clear or invalidate auth/session cookie
Frontend -> redirect /login
```

Key difference from current state:
- no dual cleanup
- no browser-side persistent bearer token
- no split semantics between normal API and SSE

---

## 10. Security Responsibility Model

### 10.1 Frontend Responsibilities
Frontend should:
- render login and error states
- issue same-origin requests
- react to `401`
- avoid persisting high-value auth credentials

Frontend should not:
- persist bearer token as long-lived browser state
- act as the system of record for session validity
- manually maintain a second browser auth truth

### 10.2 BFF Responsibilities
BFF should:
- authenticate login
- create and invalidate session/auth state
- unify API and SSE auth validation
- enforce auth-related origin policy behavior
- define auth cookie behavior
- normalize auth errors and semantics
- provide hooks for rate limit and audit

### 10.3 Nginx Responsibilities
Nginx should:
- enforce HTTPS boundary
- provide baseline security headers
- enforce baseline edge protections such as rate limiting where appropriate
- manage correct proxy headers and cache behavior
- reduce unnecessary stack fingerprinting

Nginx should not:
- implement business auth semantics
- implement RBAC decisions

### 10.4 Runtime Responsibilities
Runtime/deploy layer should:
- inject required auth/session secrets
- fail startup if critical secret is missing
- separate dev and prod behavior explicitly
- ensure secure-cookie assumptions are valid in real deployment path

---

## 11. CORS and Same-Origin Policy Decision

### Decision
Solfacil Web BFF will be treated as a **same-origin web admin backend by default**.

### Implications
- cross-origin access is not a default supported product behavior
- explicit whitelist only where real business need exists
- non-whitelist origins must be rejected through stable control flow
- non-whitelist origin handling must not produce `500`

### Reasoning
This is an admin web surface, not a general-purpose browser-consumable API platform. Same-origin should be the default boundary assumption.

---

## 12. CSRF Strategy Decision

A cookie-first model requires CSRF discipline.

### Phase 1 acceptable approach
- strict same-origin assumptions
- `HttpOnly + Secure + SameSite`
- strict `Origin` and/or `Referer` checks on modifying requests
- no permissive cross-site write behavior

### Later evolution
If the product later requires more complex domain topologies or cross-origin browser use, a dedicated CSRF token model can be introduced.

### Decision
- CSRF is in scope conceptually
- full-blown token framework is not mandatory in the very first implementation pass if strict same-origin plus origin validation is enforced correctly

---

## 13. Secret and Fail-Fast Decision

### Decision
Critical auth secret behavior must be fail-fast.

Rules:
1. no production auth path may silently fall back to development secret defaults
2. missing required auth/session secret must fail startup
3. dev fallback, if retained at all, must be isolated to explicit development entrypoints only
4. startup behavior should clearly indicate whether secret requirements are satisfied

### Reasoning
Allowing production trust roots to degrade silently is incompatible with a credible auth boundary.

---

## 14. Cookie Policy Decision

Auth/session cookie must at minimum be:
- `HttpOnly`
- `Secure`
- explicit `SameSite` policy
- explicit path
- explicit lifetime behavior where relevant

Engineering target for this cycle:
- signed auth token in secure HttpOnly cookie

Long-term preferred model:
- opaque server-governed session cookie

---

## 15. Login Abuse Control Decision

Login surface must receive baseline abuse resistance in this remediation.

Minimum expected capabilities:
- IP-level rate limiting
- account-level failure counting or backoff
- unified external error semantics to reduce user-state enumeration
- baseline login success and failure audit logging

This is part of the auth boundary, not a separate future concern.

---

## 16. Scope Definition

### 16.1 In Scope
#### A. Browser session model remediation
- remove persistent browser bearer token
- unify normal API and SSE auth path
- rewrite auth guard semantics
- unify logout and `401` behavior

#### B. BFF auth boundary remediation
- login handler
- logout handler
- auth middleware
- cookie policy
- CORS behavior
- secret fail-fast behavior
- auth error semantics

#### C. Proxy and transport hardening
- baseline security headers
- proxy header correctness
- no-store behavior where required
- stack fingerprint reduction
- edge rate limiting baseline

#### D. Runtime and deploy governance
- secret injection
- explicit dev/prod separation
- startup validation
- secure-cookie deployment assumptions

#### E. Verification and rollout control
- unit and integration coverage where relevant
- browser validation
- external read-only validation
- deployment and rollback checklist

### 16.2 Out of Scope for This Cycle
- MFA
- full platform identity unification
- full RBAC redesign
- organization-wide password policy redesign
- WAF platform buildout
- global security operations program
- full secret management platform migration across all services

Reason:
The current effort is a **Web Auth Boundary Remediation**, not a total security platform rebuild.

---

## 17. Implementation Roadmap

### Phase 1, Authentication Model Convergence
Goal:
- remove split browser session truth
- move to cookie-first auth behavior

Main changes:
- remove localStorage token persistence
- remove manual bearer header assembly for normal browser API calls
- unify API and SSE auth path
- unify logout and `401` behavior

Main components:
- `frontend-v2/login.html`
- `frontend-v2/js/data-source.js`
- `frontend-v2/js/app.js`
- `frontend-v2/js/p2-devices.js`
- `backend/src/bff/handlers/auth-login.ts`
- `backend/src/bff/middleware/auth.ts`
- related auth/session flow logic

Done when:
- no auth token remains in browser localStorage
- normal API works via cookie-backed auth
- SSE works via same auth/session path
- logout clears single auth truth
- `401` behavior is consistent

### Phase 2, Auth Boundary Hardening
Goal:
- make auth boundary fail-closed and explicit

Main changes:
- secret fail-fast
- secure cookie
- stable non-whitelist origin rejection
- unified auth error semantics
- reduce user-state enumeration

Done when:
- missing required secret prevents startup
- auth cookie is `HttpOnly + Secure + SameSite`
- malicious/non-whitelist origin no longer triggers `500`
- public auth errors are normalized

### Phase 3, Proxy and Browser Security Policy Unification
Goal:
- unify edge and browser-facing protection policy

Main changes:
- Nginx security headers
- stack fingerprint reduction
- cache/no-store review for auth-related responses
- CSP rollout planning, beginning with compatible mode

Done when:
- core auth pages and responses receive consistent security headers
- unnecessary stack exposure is reduced
- header strategy does not break frontend behavior

### Phase 4, Login Abuse Resistance and Audit
Goal:
- make login boundary resilient against basic abuse

Main changes:
- rate limiting
- account failure tracking or backoff
- baseline auth audit logging
- unified public failure semantics

Done when:
- high-rate abuse is throttled
- account state cannot be trivially inferred from public responses
- login attempts are minimally auditable

### Phase 5, Verification, Rollout, and Rollback Control
Goal:
- prove the new model works end to end in real deployment conditions

Validation scope:
- login
- logout
- refresh behavior
- normal API access
- SSE behavior
- `401` behavior
- cookie attributes in real HTTPS path
- non-whitelist origin handling
- security headers
- rollback readiness

Done when:
- functional and security validation are both passed
- deployment order is defined
- rollback path is tested or at minimum fully documented

---

## 18. Dependency and Ordering Model

Recommended order:

```text
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5
```

Key rule:
- do not prioritize superficial hardening over unresolved split session architecture

Meaning:
- do not stop at headers or rate limit while API and SSE still use diverged auth semantics

---

## 19. Risks to Control During Implementation

### Risk 1, Hidden frontend dependence on localStorage auth state
Mitigation:
- repo-wide search for all auth state reads
- centralize auth helpers

### Risk 2, Production cookie behavior differs from local test behavior
Mitigation:
- validate under real HTTPS deployment path early
- confirm domain, path, SameSite, and Secure behavior under actual routing

### Risk 3, SSE regression during auth convergence
Mitigation:
- treat SSE as first-class acceptance target
- do not assume it behaves like ordinary fetch

### Risk 4, Security headers break existing frontend assets or inline code
Mitigation:
- stage CSP carefully
- begin with compatible policy then tighten

### Risk 5, Abuse controls harm normal use
Mitigation:
- start with conservative thresholds
- ensure observability exists before aggressive tightening

---

## 20. Pre-Implementation Facts That Must Be Confirmed

The following facts still need explicit confirmation before implementation begins.

### 20.1 Production access topology
Need confirmed:
- canonical public URL
- real route base for web UI
- whether any upstream CDN/LB exists
- where TLS terminates
- whether the production request path matches the current host-level assumptions

### 20.2 Production runtime model
Need confirmed:
- actual production deploy mode
- real startup entrypoint for BFF
- actual secret injection path
- whether current prod could ever hit auth-secret fallback
- whether there is one BFF instance or more than one

### 20.3 Product session behavior expectations
Need confirmed:
- intended session TTL
- whether “remember me” exists or is desired
- multi-device concurrency expectations
- whether forced logout of all sessions is desired
- whether role/permission changes must invalidate active sessions immediately

### 20.4 External clients of BFF
Need confirmed:
- whether any non-browser client depends on current bearer-token browser flow
- whether any script or integration expects `Authorization: Bearer` from a browser context

These answers determine whether the auth model convergence can be clean or requires temporary compatibility shims.

---

## 21. Implementation Readiness Checklist

### Architecture decisions
- [ ] Cookie-first model confirmed
- [ ] this cycle target confirmed as JWT cookie only
- [ ] long-term path to server-side session acknowledged
- [ ] same-origin default confirmed
- [ ] non-whitelist cross-origin default rejection confirmed
- [ ] scope exclusions confirmed

### Runtime facts
- [ ] production secret injection path confirmed
- [ ] production fallback risk confirmed or disproven
- [ ] TLS termination layer confirmed
- [ ] production reverse proxy chain confirmed
- [ ] auth cookie domain/path assumptions confirmed

### Product behavior
- [ ] session TTL confirmed
- [ ] refresh behavior expectation confirmed
- [ ] logout semantics confirmed
- [ ] multi-session behavior confirmed
- [ ] role-change invalidation expectation confirmed

### Engineering preparation
- [ ] affected file list frozen
- [ ] test environment ready
- [ ] external read-only verification method reproducible
- [ ] rollback path pre-defined
- [ ] ownership split confirmed

---

## 22. Workstream Breakdown

### Track A, Architecture and Decision Track
Scope:
- auth model choice
- scope boundaries
- security responsibility model
- acceptance criteria
- ADR and design outputs

Owner:
- **Ashe**

Why:
- this is decision work, not implementation work

### Track B, Code Impact Discovery Track
Scope:
- all `localStorage.solfacil_jwt` reads
- all manual `Authorization` assembly points
- all auth guard logic
- all login/logout dependencies
- all SSE auth dependencies
- all CORS/secret/cookie implementation points

Owner:
- **Claude Code is well-suited**

Why:
- repo-wide discovery and indexing is execution-heavy and systematic

### Track C, Auth Model Refactor Track
Scope:
- login response handling changes
- frontend request auth changes
- auth middleware changes
- API/SSE convergence
- logout/`401` behavior unification

Owner:
- **Claude Code can implement under strict design constraints**

### Track D, Boundary Hardening Track
Scope:
- secret fail-fast
- secure cookie
- CORS stable rejection
- auth error normalization
- fingerprint reduction

Owner:
- **Claude Code can implement, Ashe validates correctness and scope**

### Track E, Proxy and Deploy Track
Scope:
- Nginx header policy
- cache/no-store strategy
- rate limit baseline
- deploy and rollback strategy

Owner:
- **Ashe leads design, Claude Code may assist with config drafts**

### Track F, Validation and Regression Track
Scope:
- tests
- browser smoke flows
- external read-only verification scripts
- rollout checklist and observation points

Owner:
- **Claude Code may generate tests/scripts, Ashe defines acceptance and reviews outcomes**

---

## 23. Delegation Boundary

### What should be delegated to Claude Code
Suitable delegation tasks:
- repo-wide auth impact discovery
- affected file mapping
- reference chain discovery
- test gap scanning
- patch implementation after design freeze
- config draft generation after policy freeze
- regression script drafting

### What should remain Ashe-led
Must remain architecture-led, not execution-led:
- target auth model choice
- scope inclusion and exclusion
- risk prioritization
- cross-layer consistency review
- acceptance criteria definition
- rollout gate decisions

### Recommended collaboration model
Use a two-layer model:
- **Ashe as architecture and acceptance owner**
- **Claude Code as implementation and repo-analysis execution layer**

In plain terms:
- Ashe remains the brain
- Claude Code can be the hands once the design is frozen

---

## 24. Next Practical Step

Before code modification begins, the next correct move is:

1. confirm the unresolved production and product facts listed in Section 20
2. freeze this document as the implementation baseline
3. issue a constrained repo-analysis delegation to Claude Code for Track B
4. review the returned impact map against this architecture
5. only then open implementation workstreams

---

## 25. Final Conclusion

Formal conclusion:

> Solfacil Web authentication should be remediated as a **Web Auth Boundary convergence project**, not as a loose collection of isolated fixes. The current system is a mixed browser auth model split across `localStorage`, cookie state, BFF dual-input validation, and permissive runtime fallback behavior. The correct remediation path is to converge to a **Cookie-first single browser session model**, using **JWT in HttpOnly Secure cookie** as the engineering target for this cycle, with a preserved upgrade path to **server-side session** in the long term. The remediation must proceed in the order of session convergence, boundary hardening, proxy/browser policy unification, abuse resistance, and end-to-end verification.

Operational conclusion:

- first fix the session model
- then close the auth boundary
- then unify proxy/browser protection
- then add entrance abuse controls
- then validate and ship with rollback discipline

That is the line between patching symptoms and actually repairing the system.
