import { describe, expect, test } from "bun:test";
import { allocate, dominantShare, jainIndex } from "../src/drf.js";
import { MaraError, type MaraErrorCode } from "../src/errors.js";

function expectMaraCode(fn: () => unknown, code: MaraErrorCode): void {
  try {
    fn();
    throw new Error(`expected ${code}, but no error was thrown`);
  } catch (err) {
    if (err instanceof MaraError) {
      expect(err.code).toBe(code);
      return;
    }
    throw err;
  }
}

describe("allocate", () => {
  test("a single agent receives its full demand", () => {
    const result = allocate({ resources: { cpu: 8 }, agents: [{ id: "a", demand: { cpu: 5 } }] });
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.allocated["cpu"]).toBe(5);
    expect(result.allocations[0]!.status).toBe("allocated");
    expect(result.allocations[0]!.reason).toBeUndefined();
    expect(result.resources[0]!.leftover).toBe(3);
  });

  test("an uncontended fleet serves every agent fully with fairness 1", () => {
    const result = allocate({
      resources: { cpu: 16, memory: 64 },
      agents: [
        { id: "a", demand: { cpu: 4, memory: 8 } },
        { id: "b", demand: { cpu: 6, memory: 12 } },
      ],
    });
    for (const allocation of result.allocations) {
      expect(allocation.status).toBe("allocated");
      expect(allocation.allocated["cpu"]).toBe(allocation.demand["cpu"]);
      expect(allocation.allocated["memory"]).toBe(allocation.demand["memory"]);
    }
    expect(result.resources.map((r) => r.leftover)).toEqual([6, 44]);
  });

  test("contention equalizes dominant shares for equal weights", () => {
    const result = allocate({
      resources: { cpu: 10 },
      agents: [
        { id: "a", demand: { cpu: 10 } },
        { id: "b", demand: { cpu: 10 } },
      ],
    });
    const shares = result.allocations.map((allocation) => allocation.dominantShare);
    expect(Math.abs(shares[0]! - shares[1]!)).toBeLessThanOrEqual(1 / 64 + 1e-9);
    expect(result.fairness).toBeGreaterThan(0.99);
  });

  test("weight scales dominant share under contention", () => {
    const result = allocate({
      resources: { cpu: 9 },
      agents: [
        { id: "a", weight: 2, demand: { cpu: 9 } },
        { id: "b", demand: { cpu: 9 } },
      ],
    });
    const a = result.allocations.find((entry) => entry.agentId === "a")!;
    const b = result.allocations.find((entry) => entry.agentId === "b")!;
    expect(a.dominantShare).toBeGreaterThan(0.6);
    expect(b.dominantShare).toBeLessThan(0.4);
    expect(a.dominantShare / b.dominantShare).toBeGreaterThan(1.6);
    expect(a.dominantShare / b.dominantShare).toBeLessThan(2.4);
  });

  test("minimum guarantees are reserved under total contention", () => {
    const result = allocate({
      resources: { cpu: 10 },
      agents: [
        { id: "chat", weight: 0.001, minGuarantee: { cpu: 2 }, demand: { cpu: 10 } },
        { id: "hog", weight: 100, demand: { cpu: 10 } },
      ],
    });
    const chat = result.allocations.find((entry) => entry.agentId === "chat")!;
    const hog = result.allocations.find((entry) => entry.agentId === "hog")!;
    expect(chat.allocated["cpu"]!).toBeGreaterThanOrEqual(2);
    expect(hog.allocated["cpu"]!).toBeGreaterThan(7.9);
    expect(hog.allocated["cpu"]!).toBeLessThanOrEqual(8);
    expect(result.resources[0]!.reserved).toBe(2);
  });

  test("guarantees exceeding capacity are rejected", () => {
    expectMaraCode(
      () =>
        allocate({
          resources: { cpu: 4 },
          agents: [
            { id: "a", minGuarantee: { cpu: 3 }, demand: {} },
            { id: "b", minGuarantee: { cpu: 2 }, demand: {} },
          ],
        }),
      "MARA_GUARANTEE_EXCEEDS_CAPACITY",
    );
  });

  test("agents never receive more than they demanded", () => {
    const result = allocate({
      resources: { cpu: 64, memory: 256, api_quota: 12000, gpu: 8 },
      agents: [
        { id: "a", weight: 5, demand: { cpu: 2, memory: 4, api_quota: 10 } },
        { id: "b", weight: 5, demand: { cpu: 2, gpu: 1 } },
      ],
    });
    for (const allocation of result.allocations) {
      for (const [resId, amount] of Object.entries(allocation.demand)) {
        expect(allocation.allocated[resId]!).toBeLessThanOrEqual(amount + 1e-9);
      }
    }
  });

  test("allocation conserves capacity exactly", () => {
    const result = allocate({
      resources: { cpu: 7.5, memory: 100 },
      agents: [
        { id: "a", demand: { cpu: 7.5, memory: 80 } },
        { id: "b", demand: { cpu: 7.5, memory: 80 } },
      ],
    });
    for (const row of result.resources) {
      expect(row.allocated + row.leftover).toBeCloseTo(row.capacity, 9);
      expect(row.leftover).toBeGreaterThanOrEqual(0);
    }
  });

  test("input order does not change the outcome", () => {
    const agents = [
      { id: "a", weight: 1.5, demand: { cpu: 16, memory: 96 } },
      { id: "b", weight: 1, demand: { cpu: 8, memory: 24 } },
      { id: "c", weight: 2, demand: { cpu: 8, memory: 32 } },
    ];
    const forward = allocate({ resources: { cpu: 20, memory: 120 }, agents });
    const reversed = allocate({ resources: { cpu: 20, memory: 120 }, agents: [...agents].reverse() });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  test("demand on a zero-capacity resource is blocked with a reason, not NaN", () => {
    const result = allocate({
      resources: { cpu: 4, gpu: 0 },
      agents: [{ id: "viz", demand: { cpu: 1, gpu: 2 } }],
    });
    const viz = result.allocations[0]!;
    expect(Number.isFinite(viz.dominantShare)).toBe(true);
    expect(viz.status).toBe("blocked");
    expect(viz.reason).toBe("insufficient gpu");
    expect(viz.allocated["cpu"]).toBe(0);
    expect(viz.allocated["gpu"]).toBe(0);
  });

  test("blocked agents report the binding resource", () => {
    const result = allocate({
      resources: { cpu: 3 },
      agents: [
        { id: "a", demand: { cpu: 3 } },
        { id: "b", demand: { cpu: 3 } },
      ],
    });
    for (const allocation of result.allocations) {
      expect(allocation.status).toBe("partial");
      expect(allocation.reason).toBe("insufficient cpu");
    }
  });

  test("an agent whose guarantee covers its demand is fully served", () => {
    const result = allocate({
      resources: { cpu: 4 },
      agents: [{ id: "a", minGuarantee: { cpu: 2 }, demand: { cpu: 2 } }],
    });
    expect(result.allocations[0]!.status).toBe("allocated");
  });

  test("stepsPerDemand is honored as the grant granularity", () => {
    const result = allocate(
      {
        resources: { cpu: 10 },
        agents: [
          { id: "a", demand: { cpu: 10 } },
          { id: "b", demand: { cpu: 10 } },
        ],
      },
      { stepsPerDemand: 8 },
    );
    expect(result.grants).toBeLessThanOrEqual(2 * 8 + 16);
  });

  test("invalid stepsPerDemand is rejected", () => {
    expectMaraCode(() => allocate(VALID_SPEC, { stepsPerDemand: 0 }), "MARA_INVALID_OPTIONS");
    expectMaraCode(() => allocate(VALID_SPEC, { stepsPerDemand: 5000 }), "MARA_INVALID_OPTIONS");
    expectMaraCode(() => allocate(VALID_SPEC, { stepsPerDemand: 3.5 }), "MARA_INVALID_OPTIONS");
  });
});

const VALID_SPEC = { resources: { cpu: 4 }, agents: [{ id: "a", demand: { cpu: 2 } }] };

describe("dominantShare", () => {
  test("is the max fraction over positive-capacity resources", () => {
    expect(dominantShare({ cpu: 4, memory: 50 }, { cpu: 8, memory: 100 })).toBe(0.5);
  });

  test("ignores zero-capacity resources", () => {
    expect(dominantShare({ cpu: 2, gpu: 5 }, { cpu: 4, gpu: 0 })).toBe(0.5);
    expect(Number.isNaN(dominantShare({ gpu: 5 }, { gpu: 0 }))).toBe(false);
  });

  test("treats missing allocations as zero", () => {
    expect(dominantShare({}, { cpu: 4 })).toBe(0);
  });
});

describe("jainIndex", () => {
  test("is 1 for an empty set", () => {
    expect(jainIndex([])).toBe(1);
  });

  test("is 1 for equal shares", () => {
    expect(jainIndex([0.5, 0.5, 0.5])).toBeCloseTo(1, 12);
  });

  test("is 0.5 for one winner and one nothing", () => {
    expect(jainIndex([1, 0])).toBeCloseTo(0.5, 12);
  });

  test("is 1 when every share is zero", () => {
    expect(jainIndex([0, 0])).toBe(1);
  });
});
