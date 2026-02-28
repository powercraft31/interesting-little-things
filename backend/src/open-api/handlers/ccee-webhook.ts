import type { Request, Response } from "express";
import { getPool } from "../../shared/db";

function getWebhookSecret(): string {
  return process.env.WEBHOOK_SECRET ?? "dev-secret-2026";
}

export interface CceePldPayload {
  mes_referencia: number; // 202602
  dia: number; // 1-31
  hora: number; // 0-23
  submercado: "SUDESTE" | "SUL" | "NORDESTE" | "NORTE";
  price_brl_mwh: number; // e.g. 487.50
  published_at?: string;
}

export async function handleCceeWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // 1. Verify secret
  const secret = req.headers["x-webhook-secret"];
  if (secret !== getWebhookSecret()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // 2. Parse payload
  const payload = req.body as CceePldPayload;
  if (
    !payload.mes_referencia ||
    payload.dia == null ||
    payload.hora == null ||
    !payload.submercado ||
    payload.price_brl_mwh == null
  ) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  // 3. Validate submercado
  const validSubm = ["SUDESTE", "SUL", "NORDESTE", "NORTE"];
  if (!validSubm.includes(payload.submercado)) {
    res
      .status(400)
      .json({ error: `Invalid submercado: ${payload.submercado}` });
    return;
  }

  // 4. UPSERT pld_horario
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO pld_horario (mes_referencia, dia, hora, submercado, pld_hora)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (mes_referencia, dia, hora, submercado)
      DO UPDATE SET pld_hora = EXCLUDED.pld_hora
    `,
      [
        payload.mes_referencia,
        payload.dia,
        payload.hora,
        payload.submercado,
        payload.price_brl_mwh,
      ],
    );

    res.status(200).json({
      status: "accepted",
      rows_upserted: 1,
      detail: `pld_horario updated: ${payload.submercado} ${payload.mes_referencia}/${payload.dia} hora=${payload.hora} → R$${payload.price_brl_mwh}/MWh`,
    });
  } catch (err) {
    console.error("[ccee-webhook] DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
}
