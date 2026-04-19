import type { RuntimeFlags } from "./flags";
import { buildHealthSnapshotInput } from "./health";
import {
  fetchActiveRuntimeIssues,
  fetchLatestSelfChecks,
  insertRuntimeHealthSnapshot,
  runWithServicePool,
  type RuntimeQueryable,
} from "./persistence";

export interface CaptureRuntimeHealthSnapshotOptions {
  readonly flags: RuntimeFlags;
  readonly now?: Date;
  readonly client?: RuntimeQueryable;
  readonly snapshotSource?: string;
}

export type RuntimeHealthSnapshotCaptureResult =
  | { readonly status: "disabled" }
  | {
      readonly status: "captured";
      readonly snapshotId: number;
      readonly capturedAt: string;
    };

async function captureWithClient(
  client: RuntimeQueryable,
  options: CaptureRuntimeHealthSnapshotOptions,
): Promise<Exclude<RuntimeHealthSnapshotCaptureResult, { status: "disabled" }>> {
  const [activeIssues, selfChecks] = await Promise.all([
    fetchActiveRuntimeIssues(client),
    fetchLatestSelfChecks(client),
  ]);
  const capturedAt = (options.now ?? new Date()).toISOString();
  const snapshot = buildHealthSnapshotInput({
    activeIssues,
    selfChecks,
    capturedAt,
    snapshotSource: options.snapshotSource ?? "cron",
  });
  const snapshotId = await insertRuntimeHealthSnapshot(client, snapshot);
  return {
    status: "captured",
    snapshotId,
    capturedAt,
  };
}

export async function captureRuntimeHealthSnapshot(
  options: CaptureRuntimeHealthSnapshotOptions,
): Promise<RuntimeHealthSnapshotCaptureResult> {
  if (!options.flags.governanceEnabled) {
    return { status: "disabled" };
  }

  if (options.client) {
    return captureWithClient(options.client, options);
  }

  return runWithServicePool((client) => captureWithClient(client, options));
}
