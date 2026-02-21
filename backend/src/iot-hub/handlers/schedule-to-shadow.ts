/**
 * IoT Hub — 调度计划同步到设备影子 Handler
 *
 * 接收来自 EventBridge 的 ScheduleGenerated 事件。
 * 骨架代码 — 将在阶段 2b 中更新 Device Shadow。
 */
export async function handler(event: unknown): Promise<void> {
  console.log('schedule-to-shadow received:', JSON.stringify(event));
  // TODO: 解析调度计划，调用 IoT Data Plane UpdateThingShadow 更新每个设备
}
