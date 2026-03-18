import { Pool } from "pg";
import type {
  SolfacilMessage,
  GatewayRecord,
} from "../../shared/types/solfacil-protocol";
import { publishSubDevicesGet } from "../handlers/publish-config";
import { publishConfigGet } from "../handlers/publish-config";

/**
 * PR3: MQTT Connection Manager
 *
 * Reads gateways table at startup, connects to each gateway's MQTT broker,
 * subscribes to 6 topics per gateway (Solfacil Protocol v1.2).
 * Polls every 60s for new gateways. Marks offline after 10min without heartbeat.
 */

export type TopicHandler = (
  pool: Pool,
  gatewayId: string,
  clientId: string,
  payload: SolfacilMessage,
) => Promise<void>;

export interface TopicHandlers {
  readonly onDeviceList: TopicHandler;
  readonly onTelemetry: TopicHandler;
  readonly onGetReply: TopicHandler;
  readonly onSetReply: TopicHandler;
  readonly onHeartbeat: TopicHandler;
  readonly onMissedData: TopicHandler;
}

interface GatewayClient {
  readonly gatewayId: string;
  readonly clientId: string;
  readonly mqttClient: unknown; // mqtt.MqttClient at runtime
}

const POLL_INTERVAL_MS = 60_000;
const OFFLINE_THRESHOLD_MS = 900_000; // 15 minutes (REQ v6.1)
const HOURLY_POLL_MS = 3_600_000;

export class GatewayConnectionManager {
  private readonly gatewayClients = new Map<string, GatewayClient>();
  private pollTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly pool: Pool,
    private readonly handlers: TopicHandlers,
  ) {}

  /** Start: read gateways table → connect → subscribe. */
  async start(): Promise<void> {
    console.log("[GatewayConnectionManager] Starting...");
    const gateways = await this.loadGateways();
    console.log(
      `[GatewayConnectionManager] Found ${gateways.length} active gateways`,
    );

    for (const gw of gateways) {
      await this.connectGateway(gw);
    }

    // Poll for new gateways every 60s
    this.pollTimer = setInterval(
      () => this.pollNewGateways(),
      POLL_INTERVAL_MS,
    );

    // Watchdog: mark offline if no heartbeat for 10 minutes
    this.watchdogTimer = setInterval(
      () => this.heartbeatWatchdog(),
      POLL_INTERVAL_MS,
    );

    // Hourly poll: subDevices/get + config/get for all gateways
    this.hourlyTimer = setInterval(() => this.hourlyPoll(), HOURLY_POLL_MS);
  }

  /** Graceful shutdown: disconnect all MQTT clients. */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }

    for (const [, gc] of this.gatewayClients) {
      try {
        const client = gc.mqttClient as { end?: () => void };
        client.end?.();
      } catch {
        // best-effort cleanup
      }
    }
    this.gatewayClients.clear();
    console.log("[GatewayConnectionManager] Stopped");
  }

  /** Load active gateways from DB. */
  private async loadGateways(): Promise<GatewayRecord[]> {
    const result = await this.pool.query<GatewayRecord>(
      `SELECT gateway_id, org_id, name,
              mqtt_broker_host, mqtt_broker_port,
              mqtt_username, mqtt_password,
              status, last_seen_at
       FROM gateways
       WHERE status != 'decommissioned'`,
    );
    return result.rows;
  }

  /** Connect to a single gateway's MQTT broker and subscribe to 6 topics. */
  private async connectGateway(gw: GatewayRecord): Promise<void> {
    if (this.gatewayClients.has(gw.gateway_id)) return;

    // Lazy-require mqtt to avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mqtt = require("mqtt");

    const brokerUrl = `mqtt://${gw.mqtt_broker_host}:${gw.mqtt_broker_port}`;
    const clientSuffix = process.env.MQTT_CLIENT_SUFFIX ?? process.pid;
    const mqttClientId = `solfacil-m1-${gw.gateway_id}-${clientSuffix}`;

    const client = mqtt.connect(brokerUrl, {
      clientId: mqttClientId,
      username: gw.mqtt_username,
      password: gw.mqtt_password,
      clean: true,
      reconnectPeriod: 5000,
    });

    const cid = gw.gateway_id;
    const topics = [
      `device/ems/${cid}/deviceList`,
      `device/ems/${cid}/data`,
      `device/ems/${cid}/config/get_reply`,
      `device/ems/${cid}/config/set_reply`,
      `device/ems/${cid}/status`,
      `device/ems/${cid}/data/missed`,
    ];

    client.on("connect", () => {
      console.log(
        `[GatewayConnectionManager] Connected: ${cid} → ${brokerUrl}`,
      );
      client.subscribe(topics, { qos: 1 }, (err: Error | null) => {
        if (err) {
          console.error(
            `[GatewayConnectionManager] Subscribe error for ${cid}:`,
            err,
          );
        } else {
          console.log(
            `[GatewayConnectionManager] Subscribed ${topics.length} topics for ${cid}`,
          );
          // v1.2: Request initial sub-device list after connecting
          const publishFn = (topic: string, msg: string) =>
            client.publish(topic, msg);
          publishSubDevicesGet(cid, publishFn);
        }
      });
    });

    client.on("message", async (topic: string, payloadBuf: Buffer) => {
      try {
        const payload: SolfacilMessage = JSON.parse(payloadBuf.toString());
        await this.routeMessage(gw.gateway_id, cid, topic, payload);
      } catch (err) {
        console.error(
          `[GatewayConnectionManager] Message parse error on ${topic}:`,
          err,
        );
      }
    });

    client.on("error", (err: Error) => {
      console.error(
        `[GatewayConnectionManager] Connection error for ${cid}:`,
        err,
      );
    });

    client.on("close", () => {
      if (!this.stopped) {
        console.warn(
          `[GatewayConnectionManager] Connection closed for ${cid}, will auto-reconnect`,
        );
      }
    });

    this.gatewayClients.set(gw.gateway_id, {
      gatewayId: gw.gateway_id,
      clientId: cid,
      mqttClient: client,
    });
  }

  /** Route an MQTT message to the appropriate handler based on topic suffix. */
  private async routeMessage(
    gatewayId: string,
    clientId: string,
    topic: string,
    payload: SolfacilMessage,
  ): Promise<void> {
    try {
      if (topic.endsWith("/deviceList")) {
        await this.handlers.onDeviceList(
          this.pool,
          gatewayId,
          clientId,
          payload,
        );
      } else if (topic.endsWith("/data/missed")) {
        await this.handlers.onMissedData(
          this.pool,
          gatewayId,
          clientId,
          payload,
        );
      } else if (topic.endsWith("/data")) {
        await this.handlers.onTelemetry(
          this.pool,
          gatewayId,
          clientId,
          payload,
        );
      } else if (topic.endsWith("/config/get_reply")) {
        await this.handlers.onGetReply(this.pool, gatewayId, clientId, payload);
      } else if (topic.endsWith("/config/set_reply")) {
        await this.handlers.onSetReply(this.pool, gatewayId, clientId, payload);
      } else if (topic.endsWith("/status")) {
        await this.handlers.onHeartbeat(
          this.pool,
          gatewayId,
          clientId,
          payload,
        );
      } else {
        console.warn(`[GatewayConnectionManager] Unhandled topic: ${topic}`);
      }
    } catch (err) {
      console.error(
        `[GatewayConnectionManager] Handler error for ${topic}:`,
        err,
      );
    }
  }

  /** Poll gateways table for newly added gateways. */
  private async pollNewGateways(): Promise<void> {
    try {
      const gateways = await this.loadGateways();
      for (const gw of gateways) {
        if (!this.gatewayClients.has(gw.gateway_id)) {
          console.log(
            `[GatewayConnectionManager] New gateway detected: ${gw.gateway_id}`,
          );
          await this.connectGateway(gw);
        }
      }
    } catch (err) {
      console.error("[GatewayConnectionManager] Poll error:", err);
    }
  }

  /** Mark gateways offline if no heartbeat for >15min. Write outage events. */
  private async heartbeatWatchdog(): Promise<void> {
    try {
      // Find gateways that just went offline and update their status
      const result = await this.pool.query(
        `UPDATE gateways
         SET status = 'offline', updated_at = NOW()
         WHERE status = 'online'
           AND last_seen_at IS NOT NULL
           AND last_seen_at < NOW() - INTERVAL '${OFFLINE_THRESHOLD_MS} milliseconds'
         RETURNING gateway_id, org_id`,
      );

      // Write outage events for each newly-offline gateway
      for (const row of result.rows) {
        await this.writeOutageEvent(row.gateway_id, row.org_id);
      }
    } catch (err) {
      console.error("[GatewayConnectionManager] Watchdog error:", err);
    }
  }

  /**
   * Write a gateway outage event with 5-min flap consolidation.
   * If a recent outage ended < 5 min ago, reopen it instead of creating a new one.
   */
  private async writeOutageEvent(
    gatewayId: string,
    orgId: string,
  ): Promise<void> {
    const FLAP_WINDOW_MS = 300_000; // 5 minutes

    // Check for recent outage that ended < 5 min ago (flap consolidation)
    const recent = await this.pool.query(
      `SELECT id, ended_at FROM gateway_outage_events
       WHERE gateway_id = $1
         AND ended_at IS NOT NULL
         AND ended_at > NOW() - INTERVAL '${FLAP_WINDOW_MS} milliseconds'
       ORDER BY ended_at DESC
       LIMIT 1`,
      [gatewayId],
    );

    if (recent.rows.length > 0) {
      // Reopen existing outage (flap consolidation)
      await this.pool.query(
        `UPDATE gateway_outage_events SET ended_at = NULL WHERE id = $1`,
        [recent.rows[0].id],
      );
      console.log(
        `[GatewayConnectionManager] Flap consolidation: reopened outage ${recent.rows[0].id} for ${gatewayId}`,
      );
    } else {
      // Insert new outage event
      await this.pool.query(
        `INSERT INTO gateway_outage_events (gateway_id, org_id, started_at)
         VALUES ($1, $2, NOW())`,
        [gatewayId, orgId],
      );
      console.log(
        `[GatewayConnectionManager] New outage event for ${gatewayId}`,
      );
    }
  }

  /** Hourly poll: subDevices/get + config/get for all connected gateways. */
  private async hourlyPoll(): Promise<void> {
    for (const [, gc] of this.gatewayClients) {
      try {
        const client = gc.mqttClient as {
          publish: (topic: string, msg: string) => void;
        };
        const publishFn = (topic: string, msg: string) =>
          client.publish(topic, msg);
        publishSubDevicesGet(gc.gatewayId, publishFn);
        await publishConfigGet(this.pool, gc.gatewayId, publishFn);
      } catch (err) {
        console.error(
          `[GatewayConnectionManager] Hourly poll error for ${gc.gatewayId}:`,
          err,
        );
      }
    }
  }

  /** Expose connected gateway count for testing. */
  getConnectedCount(): number {
    return this.gatewayClients.size;
  }

  /** Check if a specific gateway is connected. */
  hasGateway(gatewayId: string): boolean {
    return this.gatewayClients.has(gatewayId);
  }

  /** Publish a message to a specific gateway's MQTT broker. Returns true if sent. */
  publishToGateway(gatewayId: string, topic: string, message: string): boolean {
    const gc = this.gatewayClients.get(gatewayId);
    if (!gc) return false;
    const client = gc.mqttClient as {
      connected?: boolean;
      publish: (t: string, m: string) => void;
    };
    if (!client.connected) return false;
    client.publish(topic, message);
    return true;
  }

  /** Check if a specific gateway has an active MQTT connection. */
  isGatewayConnected(gatewayId: string): boolean {
    const gc = this.gatewayClients.get(gatewayId);
    if (!gc) return false;
    const client = gc.mqttClient as { connected?: boolean };
    return client.connected === true;
  }
}
