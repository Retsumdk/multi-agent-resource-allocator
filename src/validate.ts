import { MaraError } from "./errors.js";
import type { AllocateOptions, AgentSpec, FleetSpec, ResourceAmounts } from "./types.js";

export interface NormalizedAgent {
  readonly id: string;
  readonly weight: number;
  readonly demand: Readonly<Record<string, number>>;
  readonly guarantee: Readonly<Record<string, number>>;
}

export interface NormalizedFleet {
  readonly resources: Readonly<Record<string, number>>;
  readonly agents: readonly NormalizedAgent[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MaraError("MARA_NON_FINITE", `${what} must be a finite number, got ${JSON.stringify(value) ?? "null"}`);
  }
  return value;
}

function normalizeAmounts(
  raw: unknown,
  agentId: string,
  field: string,
  resources: Readonly<Record<string, number>>,
): Record<string, number> {
  if (!isPlainObject(raw)) {
    throw new MaraError("MARA_INVALID_SPEC", `agent '${agentId}' ${field} must be an object mapping resource id to amount`);
  }
  const out: Record<string, number> = {};
  for (const [resId, value] of Object.entries(raw)) {
    if (!(resId in resources)) {
      throw new MaraError("MARA_UNKNOWN_RESOURCE", `agent '${agentId}' ${field} references unknown resource '${resId}'`);
    }
    const amount = assertFiniteNumber(value, `agent '${agentId}' ${field}['${resId}']`);
    if (amount < 0) {
      throw new MaraError("MARA_NEGATIVE_AMOUNT", `agent '${agentId}' ${field}['${resId}'] is negative (${amount})`);
    }
    if (amount > 0) out[resId] = amount;
  }
  return out;
}

export function normalizeFleet(input: unknown): NormalizedFleet {
  if (!isPlainObject(input)) {
    throw new MaraError("MARA_INVALID_SPEC", "fleet spec must be an object with 'resources' and 'agents'");
  }
  const rawResources = input["resources"];
  if (!isPlainObject(rawResources)) {
    throw new MaraError("MARA_INVALID_SPEC", "fleet spec must define 'resources' as an object mapping resource id to capacity");
  }
  const resources: Record<string, number> = {};
  for (const [resId, value] of Object.entries(rawResources)) {
    const capacity = assertFiniteNumber(value, `capacity of resource '${resId}'`);
    if (capacity < 0) {
      throw new MaraError("MARA_NEGATIVE_CAPACITY", `resource '${resId}' has negative capacity ${capacity}`);
    }
    resources[resId] = capacity;
  }
  if (Object.keys(resources).length === 0) {
    throw new MaraError("MARA_NO_RESOURCES", "fleet spec defines no resources");
  }

  const rawAgents = input["agents"];
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new MaraError("MARA_EMPTY_FLEET", "fleet spec must list at least one agent");
  }
  const seen = new Set<string>();
  const agents: NormalizedAgent[] = [];
  for (const raw of rawAgents) {
    if (!isPlainObject(raw)) {
      throw new MaraError("MARA_INVALID_SPEC", "each agent must be an object with an 'id' and a 'demand'");
    }
    const id = raw["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new MaraError("MARA_INVALID_SPEC", "every agent needs a non-empty string 'id'");
    }
    if (seen.has(id)) {
      throw new MaraError("MARA_DUPLICATE_AGENT_ID", `duplicate agent id '${id}'`);
    }
    seen.add(id);
    const weight = raw["weight"] === undefined ? 1 : assertFiniteNumber(raw["weight"], `weight of agent '${id}'`);
    if (weight <= 0) {
      throw new MaraError("MARA_INVALID_WEIGHT", `weight of agent '${id}' must be greater than 0, got ${weight}`);
    }
    agents.push({
      id,
      weight,
      demand: normalizeAmounts(raw["demand"], id, "demand", resources),
      guarantee:
        raw["minGuarantee"] === undefined
          ? {}
          : normalizeAmounts(raw["minGuarantee"], id, "minGuarantee", resources),
    });
  }
  agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const [resId, capacity] of Object.entries(resources)) {
    let reserved = 0;
    for (const agent of agents) reserved += agent.guarantee[resId] ?? 0;
    if (reserved > capacity) {
      throw new MaraError(
        "MARA_GUARANTEE_EXCEEDS_CAPACITY",
        `guarantees for resource '${resId}' total ${reserved}, exceeding capacity ${capacity}`,
      );
    }
  }

  return { resources, agents };
}

export function normalizeOptions(options?: AllocateOptions): { steps: number } {
  const steps = options?.stepsPerDemand ?? 64;
  if (!Number.isInteger(steps) || steps < 1 || steps > 4096) {
    throw new MaraError("MARA_INVALID_OPTIONS", `stepsPerDemand must be an integer in [1, 4096], got ${steps}`);
  }
  return { steps };
}
