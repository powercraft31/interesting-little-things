/**
 * POST /api/users — Admin user creation handler (v5.23)
 *
 * SOLFACIL_ADMIN only. Scoped to admin's own org (no cross-tenant).
 * Uses Service Pool because user_org_roles may lack RLS insert policy.
 */
import type { Request, Response } from "express";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { ok, fail } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  verifyTenantToken,
  requireRole,
} from "../../shared/middleware/tenant-context";

interface CreateUserRequest {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly orgId: string;
  readonly role: string;
}

export function createAdminUsersHandler(servicePool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // RBAC: auth middleware already verified JWT and overwrote header to raw JSON
      const token = req.headers.authorization as string;
      const ctx = verifyTenantToken(token);
      requireRole(ctx, [Role.SOLFACIL_ADMIN]);

      const { email, password, name, orgId, role } =
        req.body as CreateUserRequest;
      if (!email || !password || !name || !orgId || !role) {
        res
          .status(400)
          .json(
            fail("All fields required: email, password, name, orgId, role"),
          );
        return;
      }

      if (!Object.values(Role).includes(role as Role)) {
        res.status(400).json(fail(`Invalid role: ${role}`));
        return;
      }

      // Enforce tenant scope: admin can only create users in their own org
      if (orgId !== ctx.orgId) {
        res
          .status(403)
          .json(fail("Cannot create users outside your own organization"));
        return;
      }

      const userId = `USER_${Date.now()}`;
      const hashedPassword = await bcrypt.hash(password, 12);

      const client = await servicePool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO users (user_id, email, name, hashed_password, is_active)
           VALUES ($1, $2, $3, $4, true)`,
          [userId, email, name, hashedPassword],
        );
        await client.query(
          `INSERT INTO user_org_roles (user_id, org_id, role)
           VALUES ($1, $2, $3)`,
          [userId, orgId, role],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      res.status(201).json(ok({ userId, email, orgId, role }));
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 403) {
        res.status(403).json(fail("Forbidden"));
        return;
      }
      if (e.statusCode === 401) {
        res.status(401).json(fail(e.message ?? "Unauthorized"));
        return;
      }
      console.error("[admin-users] Error:", err);
      res.status(500).json(fail("Internal server error"));
    }
  };
}
