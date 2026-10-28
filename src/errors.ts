export type MaraErrorCode =
  | "MARA_INVALID_SPEC"
  | "MARA_EMPTY_FLEET"
  | "MARA_NO_RESOURCES"
  | "MARA_NEGATIVE_CAPACITY"
  | "MARA_DUPLICATE_AGENT_ID"
  | "MARA_UNKNOWN_RESOURCE"
  | "MARA_NEGATIVE_AMOUNT"
  | "MARA_INVALID_WEIGHT"
  | "MARA_NON_FINITE"
  | "MARA_GUARANTEE_EXCEEDS_CAPACITY"
  | "MARA_INVALID_OPTIONS";

const EXIT_CODES: Record<MaraErrorCode, number> = {
  MARA_INVALID_SPEC: 3,
  MARA_EMPTY_FLEET: 3,
  MARA_NO_RESOURCES: 3,
  MARA_NEGATIVE_CAPACITY: 3,
  MARA_DUPLICATE_AGENT_ID: 3,
  MARA_UNKNOWN_RESOURCE: 3,
  MARA_NEGATIVE_AMOUNT: 3,
  MARA_INVALID_WEIGHT: 3,
  MARA_NON_FINITE: 3,
  MARA_GUARANTEE_EXCEEDS_CAPACITY: 3,
  MARA_INVALID_OPTIONS: 3,
};

export class MaraError extends Error {
  readonly code: MaraErrorCode;
  readonly exitCode: number;

  constructor(code: MaraErrorCode, message: string, exitCode?: number) {
    super(message);
    this.name = "MaraError";
    this.code = code;
    this.exitCode = exitCode ?? EXIT_CODES[code];
  }
}
