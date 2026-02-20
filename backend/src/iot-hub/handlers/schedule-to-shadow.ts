/**
 * IoT Hub — Schedule-to-Shadow Handler
 *
 * Receives ScheduleGenerated events from EventBridge.
 * Skeleton only — will update Device Shadow in Phase 2b.
 */
export async function handler(event: unknown): Promise<void> {
  console.log('schedule-to-shadow received:', JSON.stringify(event));
  // TODO: parse schedule, call IoT Data Plane UpdateThingShadow for each device
}
