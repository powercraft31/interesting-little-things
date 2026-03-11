/**
 * MQTT Client Stub — replace with actual EMQX connection when broker is available.
 * Used by M3 command-dispatcher to publish config commands to gateways.
 */
export async function publishMqtt(topic: string, payload: string): Promise<void> {
  // TODO: Connect to EMQX broker when available
  console.log(`[MQTT STUB] → ${topic}`, payload.substring(0, 120));
}
