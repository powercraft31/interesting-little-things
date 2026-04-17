import express from "express";
import cors from "cors";
import { AddressInfo } from "node:net";
import { createCorsOriginValidator } from "../../src/bff/middleware/cors-policy";

describe("CORS origin validator", () => {
  async function startTestServer() {
    const app = express();
    app.use(
      cors({
        origin: createCorsOriginValidator(),
      }),
    );
    app.post("/api/auth/login", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = await new Promise<import("http").Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    return { server, port };
  }

  it("allows same-site preflight without 500", async () => {
    const { server, port } = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://solfacil.alwayscontrol.net",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://solfacil.alwayscontrol.net",
      );
    } finally {
      server.close();
    }
  });

  it("rejects disallowed origin without turning it into a 500", async () => {
    const { server, port } = await startTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(res.status).not.toBe(500);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      server.close();
    }
  });
});
