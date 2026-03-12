import { Pool } from "pg";
import { GatewayConnectionManager } from "./gateway-connection-manager";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const DELAY_AFTER_RECONNECT_MS = 30_000; // 30 seconds
const COOLDOWN_BETWEEN_CHUNKS_MS = 20_000; // 20 seconds
const CHUNK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

interface BackfillRow {
  readonly id: number;
  readonly gateway_id: string;
  readonly gap_start: Date;
  readonly gap_end: Date;
  readonly current_chunk_start: Date | null;
  readonly last_chunk_sent_at: Date | null;
  readonly status: string;
  readonly created_at: Date;
}

export class BackfillRequester {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly connectionManager: GatewayConnectionManager,
  ) {}

  start(): void {
    console.log(
      `[BackfillRequester] Starting (${POLL_INTERVAL_MS / 1000}s poll interval)`,
    );
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[BackfillRequester] Stopped");
  }

  private async poll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<BackfillRow>(`
        SELECT id, gateway_id, gap_start, gap_end,
               current_chunk_start, last_chunk_sent_at, status, created_at
        FROM backfill_requests
        WHERE status IN ('pending', 'in_progress')
        ORDER BY created_at ASC
        LIMIT 5
        FOR UPDATE SKIP LOCKED
      `);

      for (const req of rows) {
        await this.processRequest(client, req);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[BackfillRequester] Poll error:", err);
    } finally {
      client.release();
    }
  }

  private async processRequest(
    client: import("pg").PoolClient,
    req: BackfillRow,
  ): Promise<void> {
    const now = Date.now();

    if (req.status === "pending") {
      // Wait for delay after reconnect before starting
      const delayElapsed =
        now - req.created_at.getTime() >= DELAY_AFTER_RECONNECT_MS;
      if (!delayElapsed) return;

      // Check gateway is still connected
      if (!this.connectionManager.isGatewayConnected(req.gateway_id)) {
        await client.query(
          `UPDATE backfill_requests
           SET status = 'failed', completed_at = NOW()
           WHERE id = $1`,
          [req.id],
        );
        console.warn(
          `[BackfillRequester] Gateway ${req.gateway_id} offline, request ${req.id} failed`,
        );
        return;
      }

      // Publish first chunk
      const chunkEnd = Math.min(
        req.gap_start.getTime() + CHUNK_DURATION_MS,
        req.gap_end.getTime(),
      );
      const published = this.publishGetMissed(
        req.gateway_id,
        req.gap_start.getTime(),
        chunkEnd,
      );

      if (!published) {
        await client.query(
          `UPDATE backfill_requests
           SET status = 'failed', completed_at = NOW()
           WHERE id = $1`,
          [req.id],
        );
        console.warn(
          `[BackfillRequester] Publish failed for request ${req.id}, gateway ${req.gateway_id}`,
        );
        return;
      }

      await client.query(
        `UPDATE backfill_requests
         SET status = 'in_progress',
             current_chunk_start = gap_start,
             last_chunk_sent_at = NOW()
         WHERE id = $1`,
        [req.id],
      );
      console.log(
        `[BackfillRequester] Started request ${req.id} for ${req.gateway_id}, first chunk sent`,
      );
      return;
    }

    // status === 'in_progress'
    if (req.last_chunk_sent_at) {
      const cooldownElapsed =
        now - req.last_chunk_sent_at.getTime() >= COOLDOWN_BETWEEN_CHUNKS_MS;
      if (!cooldownElapsed) return;
    }

    // Advance to next chunk
    const currentStart = req.current_chunk_start!.getTime();
    const nextChunkStart = currentStart + CHUNK_DURATION_MS;

    if (nextChunkStart >= req.gap_end.getTime()) {
      // All chunks sent — mark completed
      await client.query(
        `UPDATE backfill_requests
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1`,
        [req.id],
      );
      console.log(
        `[BackfillRequester] Completed request ${req.id} for ${req.gateway_id}`,
      );
      return;
    }

    // Check gateway is still connected
    if (!this.connectionManager.isGatewayConnected(req.gateway_id)) {
      await client.query(
        `UPDATE backfill_requests
         SET status = 'failed', completed_at = NOW()
         WHERE id = $1`,
        [req.id],
      );
      console.warn(
        `[BackfillRequester] Gateway ${req.gateway_id} disconnected during backfill, request ${req.id} failed`,
      );
      return;
    }

    // Publish next chunk
    const chunkEnd = Math.min(
      nextChunkStart + CHUNK_DURATION_MS,
      req.gap_end.getTime(),
    );
    const published = this.publishGetMissed(
      req.gateway_id,
      nextChunkStart,
      chunkEnd,
    );

    if (!published) {
      await client.query(
        `UPDATE backfill_requests
         SET status = 'failed', completed_at = NOW()
         WHERE id = $1`,
        [req.id],
      );
      console.warn(
        `[BackfillRequester] Publish failed for request ${req.id} chunk at ${new Date(nextChunkStart).toISOString()}`,
      );
      return;
    }

    await client.query(
      `UPDATE backfill_requests
       SET current_chunk_start = to_timestamp($1 / 1000.0),
           last_chunk_sent_at = NOW()
       WHERE id = $2`,
      [nextChunkStart, req.id],
    );
    console.log(
      `[BackfillRequester] Request ${req.id}: next chunk sent (${new Date(nextChunkStart).toISOString()})`,
    );
  }

  private publishGetMissed(
    gatewayId: string,
    startMs: number,
    endMs: number,
  ): boolean {
    const topic = `platform/ems/${gatewayId}/data/get_missed`;
    const payload = {
      DS: 0,
      ackFlag: 0,
      clientId: gatewayId,
      deviceName: "EMS_N2",
      productKey: "ems",
      messageId: String(Date.now()),
      timeStamp: String(Date.now()),
      data: {
        start: String(startMs),
        end: String(endMs),
      },
    };
    return this.connectionManager.publishToGateway(
      gatewayId,
      topic,
      JSON.stringify(payload),
    );
  }
}
