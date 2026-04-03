/**
 * POST /api/auth/login — JWT login handler (v5.23)
 *
 * Uses Service Pool (BYPASSRLS) because orgId is unknown at login time.
 */
import type { Request, Response } from "express";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ok, fail } from "../../shared/types/api";

const AUTH_COOKIE_NAME = "solfacil_jwt";
const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
    const { email, password } = req.body as LoginRequest;
    if (!email || !password) {
      res.status(400).json(fail("Email and password are required"));
      return;
    }

    try {
      const result = await servicePool.query(
        `SELECT u.user_id, u.email, u.name, u.hashed_password, u.is_active,
                uor.org_id, uor.role
         FROM users u
         JOIN user_org_roles uor ON u.user_id = uor.user_id
         WHERE u.email = $1
         LIMIT 1`,
        [email],
      );

      if (result.rows.length === 0) {
        res.status(401).json(fail("Invalid email or password"));
        return;
      }

      const user = result.rows[0];

      if (!user.is_active) {
        res.status(401).json(fail("Account is disabled"));
        return;
      }

      const match = await bcrypt.compare(password, user.hashed_password);
      if (!match) {
        res.status(401).json(fail("Invalid email or password"));
        return;
      }

      const jwtSecret = process.env.JWT_SECRET || "solfacil-dev-secret";
      const payload = {
        userId: user.user_id,
        orgId: user.org_id,
        role: user.role,
      };
      const token = jwt.sign(payload, jwtSecret, { expiresIn: "24h" });

      const response: LoginResponse = {
        token,
        user: {
          userId: user.user_id,
          email: user.email,
          name: user.name,
          orgId: user.org_id,
          role: user.role,
        },
      };
      res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
      });
      res.status(200).json(ok(response));
    } catch (err) {
      console.error("[auth-login] Error:", err);
      res.status(500).json(fail("Internal server error"));
    }
  };
}

export function createLogoutHandler() {
  return async (_req: Request, res: Response): Promise<void> => {
    res.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    res.status(200).json(ok({ success: true }));
  };
}
