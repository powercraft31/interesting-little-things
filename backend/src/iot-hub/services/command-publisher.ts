import { Pool } from "pg";
import { GatewayConnectionManager } from "./gateway-connection-manager";
import {
  validateSchedule,
  buildConfigSetPayload,
} from "../handlers/schedule-translator";
import type { DomainSchedule } from "../handlers/schedule-translator";

export class CommandPublisher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly connectionManager: GatewayConnectionManager,
  ) {}

  start(): void {
    console.log("[CommandPublisher] Starting (10s poll interval)");
    this.timer = setInterval(() => this.poll(), 10_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[CommandPublisher] Stopped");
  }

  private async poll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<{
        id: number;
        gateway_id: string;
        command_type: string;
        config_name: string;
        payload_json: Record<string, unknown> | null;
      }>(`
        SELECT id, gateway_id, command_type, config_name, payload_json
        FROM device_command_logs
        WHERE result = 'dispatched'
          AND command_type = 'set'
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `);

      for (const cmd of rows) {
        await this.processCommand(client, cmd);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[CommandPublisher] Poll error:", err);
    } finally {
      client.release();
    }
  }

  private async processCommand(
    client: import("pg").PoolClient,
    cmd: {
      id: number;
      gateway_id: string;
      config_name: string;
      payload_json: Record<string, unknown> | null;
    },
  ): Promise<void> {
    // 1. Gateway offline check
    if (!this.connectionManager.isGatewayConnected(cmd.gateway_id)) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'gateway_offline', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      console.warn(
        `[CommandPublisher] Gateway ${cmd.gateway_id} offline, command ${cmd.id} failed`,
      );
      return;
    }

    // 2. Parse and validate schedule
    if (!cmd.payload_json) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'empty_payload', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      return;
    }

    const schedule = cmd.payload_json as unknown as DomainSchedule;

    try {
      validateSchedule(schedule);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "validation_error";
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = $1, resolved_at = NOW() WHERE id = $2`,
        [`validation: ${msg}`, cmd.id],
      );
      console.error(
        `[CommandPublisher] Validation failed for command ${cmd.id}: ${msg}`,
      );
      return;
    }

    // 3. Build protocol message
    const messageId = String(Date.now());
    const protocolMessage = buildConfigSetPayload(
      cmd.gateway_id,
      schedule,
      messageId,
    );

    // 4. Publish via MQTT
    const topic = `platform/ems/${cmd.gateway_id}/config/set`;
    const published = this.connectionManager.publishToGateway(
      cmd.gateway_id,
      topic,
      JSON.stringify(protocolMessage),
    );

    if (!published) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'publish_failed', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      console.warn(
        `[CommandPublisher] Publish failed for command ${cmd.id} (gateway disconnected during publish)`,
      );
      return;
    }

    // 5. Update message_id for audit trail
    await client.query(
      `UPDATE device_command_logs SET message_id = $1 WHERE id = $2`,
      [messageId, cmd.id],
    );

    console.log(
      `[CommandPublisher] Published command ${cmd.id} to ${cmd.gateway_id}, messageId=${messageId}`,
    );
  }
}
