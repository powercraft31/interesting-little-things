/**
 * POST /api/auth/login — JWT login handler
 *
 * v5.23: Original implementation.
 * v6.9 B5: Browser/machine contract split.
 *   - Default (browser): set session cookie, return { user } only, no token in body.
 *   - Machine (X-Auth-Contract: machine): return { token, user }, no cookie.
 *
 * Uses Service Pool (BYPASSRLS) because orgId is unknown at login time.
 */
import type { Request, Response } from "express";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ok, fail } from "../../shared/types/api";
import { SESSION_COOKIE_NAME } from "../middleware/auth";

const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

interface UserInfo {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly orgId: string;
  readonly role: string;
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

      const row = result.rows[0];

      if (!row.is_active) {
        res.status(401).json(fail("Account is disabled"));
        return;
      }

      const match = await bcrypt.compare(password, row.hashed_password);
      if (!match) {
        res.status(401).json(fail("Invalid email or password"));
        return;
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        console.error("[auth-login] FATAL: JWT_SECRET not set");
        res.status(500).json(fail("Server configuration error"));
        return;
      }

      const payload = {
        userId: row.user_id,
        orgId: row.org_id,
        role: row.role,
      };
      const token = jwt.sign(payload, jwtSecret, { expiresIn: "24h" });

      const user: UserInfo = {
        userId: row.user_id,
        email: row.email,
        name: row.name,
        orgId: row.org_id,
        role: row.role,
      };

      // v6.9 B5: Discriminate browser vs machine contract
      const isMachine = req.headers["x-auth-contract"] === "machine";

      if (isMachine) {
        // Machine contract: token in body, NO cookie
        res.status(200).json(ok({ token, user }));
      } else {
        // Browser contract (default): session cookie, NO token in body
        res.cookie(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          secure: IS_PRODUCTION,
          sameSite: "strict",
          path: "/",
          maxAge: AUTH_COOKIE_MAX_AGE_MS,
        });
        res.status(200).json(ok({ user }));
      }
    } catch (err) {
      console.error("[auth-login] Error:", err);
      res.status(500).json(fail("Internal server error"));
    }
  };
}

export function createLogoutHandler() {
  return async (_req: Request, res: Response): Promise<void> => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "strict",
      path: "/",
    });
    res.status(200).json(ok({ success: true }));
  };
}
