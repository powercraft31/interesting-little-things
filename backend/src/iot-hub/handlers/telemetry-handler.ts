import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";
import { FragmentAssembler } from "../services/fragment-assembler";

/**
 * PR3: TelemetryHandler (refactored)
 *
 * Processes `device/ems/{clientId}/data` messages.
 * Routes ALL messages (MSG#1-5) to FragmentAssembler for accumulation and merge.
 * No more `if (!bat) return;` — MSG#1-4 are no longer discarded.
 *
 * TimeStamp Rule: `recorded_at` comes from `payload.timeStamp`.
 * Server-side NOW() is FORBIDDEN for telemetry writes.
 */

/** Per-pool FragmentAssembler singleton. */
const assemblerMap = new WeakMap<Pool, FragmentAssembler>();

function getAssembler(pool: Pool): FragmentAssembler {
  let assembler = assemblerMap.get(pool);
  if (!assembler) {
    assembler = new FragmentAssembler(pool);
    assemblerMap.set(pool, assembler);
  }
  return assembler;
}

/**
 * Handle telemetry data message from a gateway.
 * Delegates to FragmentAssembler for fragment accumulation and merge.
 */
export async function handleTelemetry(
  pool: Pool,
  _gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const assembler = getAssembler(pool);
  assembler.receive(payload.clientId, payload);
}

/** For testing: destroy the cached assembler for a pool. */
export function _destroyAssembler(pool: Pool): void {
  const assembler = assemblerMap.get(pool);
  if (assembler) {
    assembler.destroy();
    assemblerMap.delete(pool);
  }
}

/** Safe parseFloat: returns 0 for undefined/null/empty/NaN/Infinity values. */
export function safeFloat(val: string | undefined): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}
