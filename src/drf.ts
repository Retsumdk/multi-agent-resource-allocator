import type { AgentAllocation, AgentStatus, AllocationResult, AllocateOptions, ResourceSummary } from "./types.js";
import { normalizeFleet, normalizeOptions, type NormalizedAgent } from "./validate.js";

const EPSILON = 1e-9;

/**
 * Dominant share of an allocation: the largest fraction of any single
 * resource's total capacity that the allocation holds. Resources with zero
 * capacity are ignored (their share is undefined, not zero).
 */
export function dominantShare(
  allocated: Readonly<Record<string, number>>,
  resources: Readonly<Record<string, number>>,
): number {
  let max = 0;
  for (const [resId, capacity] of Object.entries(resources)) {
    if (capacity <= 0) continue;
    const share = (allocated[resId] ?? 0) / capacity;
    if (share > max) max = share;
  }
  return max;
}

/**
 * Jain fairness index over a set of shares: (sum x)^2 / (n * sum x^2).
 * 1 means perfectly equal shares; smaller means more unequal.
 */
export function jainIndex(shares: readonly number[]): number {
  const n = shares.length;
  if (n === 0) return 1;
  let sum = 0;
  let sumSq = 0;
  for (const share of shares) {
    sum += share;
    sumSq += share * share;
  }
  if (sumSq <= 0) return 1;
  return (sum * sum) / (n * sumSq);
}

interface WorkState {
  readonly agent: NormalizedAgent;
  granted: Record<string, number>;
}

/**
 * Allocate a fleet's resources across its agents.
 *
 * Phase 1 reserves every agent's minGuarantee up front. Phase 2 runs
 * weighted dominant resource fairness over what remains: each round, the
 * agent whose dominant share per unit of weight is lowest receives one
 * grant step (1/stepsPerDemand of its demand, capped at the demand), if
 * the step fits within the remaining capacity of every resource it
 * touches. Ties break by agent id, so the result is fully deterministic.
 * The loop stops when every agent is fully served or no candidate's next
 * step fits anywhere.
 */
export function allocate(input: unknown, options?: AllocateOptions): AllocationResult {
  const fleet = normalizeFleet(input);
  const { steps } = normalizeOptions(options);
  const resources = fleet.resources;

  const states: WorkState[] = fleet.agents.map((agent) => ({ agent, granted: { ...agent.guarantee } }));

  const remaining: Record<string, number> = {};
  for (const [resId, capacity] of Object.entries(resources)) {
    let reserved = 0;
    for (const agent of fleet.agents) reserved += agent.guarantee[resId] ?? 0;
    remaining[resId] = capacity - reserved;
  }

  const fullyServed = (state: WorkState): boolean => {
    for (const [resId, amount] of Object.entries(state.agent.demand)) {
      if (amount - (state.granted[resId] ?? 0) > EPSILON) return false;
    }
    return true;
  };

  let grants = 0;
  const maxGrants = states.length * steps + 16;
  const blockedOn = new Map<WorkState, string>();
  while (grants < maxGrants) {
    const candidates = states
      .filter((state) => !fullyServed(state))
      .map((state) => ({
        state,
        key: dominantShare(state.granted, resources) / state.agent.weight,
      }))
      .sort((a, b) => (a.key !== b.key ? a.key - b.key : a.state.agent.id < b.state.agent.id ? -1 : 1));
    if (candidates.length === 0) break;

    let grantedThisRound = false;
    for (const { state } of candidates) {
      const next = { ...state.granted };
      let feasible = true;
      for (const [resId, demandAmount] of Object.entries(state.agent.demand)) {
        const target = Math.min(demandAmount, (state.granted[resId] ?? 0) + demandAmount / steps);
        const delta = target - (state.granted[resId] ?? 0);
        if (delta > (remaining[resId] ?? 0) + EPSILON) {
          feasible = false;
          blockedOn.set(state, resId);
          break;
        }
        next[resId] = target;
      }
      if (!feasible) continue;
      for (const [resId, target] of Object.entries(next)) {
        const delta = target - (state.granted[resId] ?? 0);
        if (delta !== 0) {
          remaining[resId] = (remaining[resId] ?? 0) - delta;
          state.granted[resId] = target;
        }
      }
      grants += 1;
      grantedThisRound = true;
      break;
    }
    if (!grantedThisRound) break;
  }

  const allocations: AgentAllocation[] = states.map((state) => {
    const { id, weight, demand, guarantee } = state.agent;
    const allocated: Record<string, number> = {};
    for (const resId of Object.keys(demand)) allocated[resId] = state.granted[resId] ?? 0;
    for (const resId of Object.keys(guarantee)) {
      if (!(resId in allocated)) allocated[resId] = state.granted[resId] ?? 0;
    }
    let unmetAmount = 0;
    let binding = "";
    for (const [resId, amount] of Object.entries(demand)) {
      const gap = amount - (allocated[resId] ?? 0);
      if (gap > unmetAmount) {
        unmetAmount = gap;
        binding = resId;
      }
    }
    let beyondGuarantee = false;
    for (const [resId, amount] of Object.entries(allocated)) {
      if (amount - (guarantee[resId] ?? 0) > EPSILON) {
        beyondGuarantee = true;
        break;
      }
    }
    const status: AgentStatus =
      unmetAmount <= EPSILON ? "allocated" : beyondGuarantee ? "partial" : "blocked";
    return {
      agentId: id,
      weight,
      demand: { ...demand },
      minGuarantee: { ...guarantee },
      allocated,
      dominantShare: dominantShare(allocated, resources),
      status,
      reason: status === "allocated" ? undefined : `insufficient ${blockedOn.get(state) ?? binding}`,
    };
  });

  const resourceRows: ResourceSummary[] = Object.keys(resources)
    .sort()
    .map((resId) => {
      const capacity = resources[resId] ?? 0;
      let reserved = 0;
      let total = 0;
      for (const allocation of allocations) {
        reserved += allocation.minGuarantee[resId] ?? 0;
        total += allocation.allocated[resId] ?? 0;
      }
      return {
        resourceId: resId,
        capacity,
        reserved,
        allocated: total,
        leftover: capacity - total,
        utilization: capacity > 0 ? total / capacity : 0,
      };
    });

  return {
    allocations,
    resources: resourceRows,
    fairness: jainIndex(allocations.map((allocation) => allocation.dominantShare)),
    grants,
  };
}
