/**
 * GET /api/auth/session — Browser session endpoint (v6.9 B4)
 *
 * Cookie-only. Returns current user state from DB.
 * Bearer-only requests are rejected with 401.
 *
 * Uses queryWithOrg (App Pool with RLS) scoped by orgId from JWT claims.
 */
import type { Request, Response } from "express";
import { ok, fail } from "../../shared/types/api";
import { SESSION_COOKIE_NAME } from "../middleware/auth";

interface SessionData {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
  readonly name: string | null;
  readonly email: string;
}

type QueryWithOrgFn = (
  sql: string,
  params: unknown[],
  orgId: string | null,
) => Promise<{ rows: Record<string, unknown>[] }>;

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey] = part.trim().split("=");
    if (rawKey === name) return rawKey;
  }
  return null;
}

export function createSessionHandler(queryWithOrg: QueryWithOrgFn) {
  return async (req: Request, res: Response): Promise<void> => {
    // B4.2: Cookie-only — reject if no session cookie present
    const hasCookie = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME) !== null;
    if (!hasCookie) {
      res.status(401).json(fail("Session expired or invalid"));
      return;
    }

    // B4.3: Extract claims from auth middleware's JSON rewrite
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json(fail("Session expired or invalid"));
      return;
    }

    let claims: { userId?: string; orgId?: string; role?: string };
    try {
      claims = JSON.parse(authHeader);
    } catch {
      res.status(401).json(fail("Session expired or invalid"));
      return;
    }

    const { userId, orgId, role } = claims;
    if (!userId || !orgId || !role) {
      res.status(401).json(fail("Session expired or invalid"));
      return;
    }

    // B4.4: Query DB for fresh user metadata
    try {
      const result = await queryWithOrg(
        `SELECT u.user_id, u.email, u.name, uor.org_id, uor.role
         FROM users u
         JOIN user_org_roles uor ON u.user_id = uor.user_id
         WHERE u.user_id = $1
         LIMIT 1`,
        [userId],
        orgId,
      );

      if (result.rows.length === 0) {
        res.status(401).json(fail("Session expired or invalid"));
        return;
      }

      const row = result.rows[0];
      const data: SessionData = {
        userId: row.user_id as string,
        orgId: row.org_id as string,
        role: row.role as string,
        name: (row.name as string | null) ?? null,
        email: row.email as string,
      };

      res.status(200).json(ok(data));
    } catch (err) {
      console.error("[auth-session] Error:", err);
      res.status(500).json(fail("Internal server error"));
    }
  };
}
