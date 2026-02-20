/**
 * Shared constants for the SolFacil VPP infrastructure.
 * Naming conventions and resource identifiers.
 */

export const PROJECT_PREFIX = 'SolfacilVpp';

export const STAGE = {
  DEV: 'dev',
  STAGING: 'staging',
  PROD: 'prod',
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

/** Default stage for local development */
export const DEFAULT_STAGE: Stage = STAGE.DEV;

/** Resource naming helper: produces e.g. "SolfacilVpp-dev-BffApi" */
export function resourceName(stage: Stage, name: string): string {
  return `${PROJECT_PREFIX}-${stage}-${name}`;
}
