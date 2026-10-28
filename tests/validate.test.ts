import { describe, expect, test } from "bun:test";
import { MaraError, type MaraErrorCode } from "../src/errors.js";
import { normalizeFleet } from "../src/validate.js";

function expectCode(fn: () => unknown, code: MaraErrorCode): void {
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

const VALID = { resources: { cpu: 4 }, agents: [{ id: "a", demand: { cpu: 2 } }] };

describe("normalizeFleet", () => {
  test("accepts a valid spec and applies defaults", () => {
    const fleet = normalizeFleet(VALID);
    expect(fleet.agents).toHaveLength(1);
    expect(fleet.agents[0]!.weight).toBe(1);
    expect(fleet.agents[0]!.guarantee).toEqual({});
  });

  test("sorts agents by id for determinism", () => {
    const fleet = normalizeFleet({
      resources: { cpu: 4 },
      agents: [
        { id: "z", demand: { cpu: 1 } },
        { id: "a", demand: { cpu: 1 } },
      ],
    });
    expect(fleet.agents.map((agent) => agent.id)).toEqual(["a", "z"]);
  });

  test("drops zero amounts from demand", () => {
    const fleet = normalizeFleet({ resources: { cpu: 4 }, agents: [{ id: "a", demand: { cpu: 0 } }] });
    expect(fleet.agents[0]!.demand).toEqual({});
  });

  test("rejects non-object specs", () => {
    expectCode(() => normalizeFleet(null), "MARA_INVALID_SPEC");
    expectCode(() => normalizeFleet(42), "MARA_INVALID_SPEC");
    expectCode(() => normalizeFleet({}), "MARA_INVALID_SPEC");
  });

  test("rejects missing or malformed resources", () => {
    expectCode(() => normalizeFleet({ agents: [{ id: "a", demand: {} }] }), "MARA_INVALID_SPEC");
    expectCode(() => normalizeFleet({ resources: [], agents: [{ id: "a", demand: {} }] }), "MARA_INVALID_SPEC");
  });

  test("rejects an empty resource pool", () => {
    expectCode(() => normalizeFleet({ resources: {}, agents: [{ id: "a", demand: {} }] }), "MARA_NO_RESOURCES");
  });

  test("rejects negative capacity", () => {
    expectCode(() => normalizeFleet({ resources: { cpu: -1 }, agents: [] }), "MARA_NEGATIVE_CAPACITY");
  });

  test("rejects an empty agent list", () => {
    expectCode(() => normalizeFleet({ resources: { cpu: 1 }, agents: [] }), "MARA_EMPTY_FLEET");
  });

  test("rejects duplicate agent ids", () => {
    expectCode(
      () =>
        normalizeFleet({
          resources: { cpu: 1 },
          agents: [
            { id: "a", demand: {} },
            { id: "a", demand: {} },
          ],
        }),
      "MARA_DUPLICATE_AGENT_ID",
    );
  });

  test("rejects invalid weights", () => {
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", weight: 0, demand: {} }] }),
      "MARA_INVALID_WEIGHT",
    );
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", weight: -2, demand: {} }] }),
      "MARA_INVALID_WEIGHT",
    );
  });

  test("rejects unknown resources in demand and guarantees", () => {
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", demand: { gpu: 1 } }] }),
      "MARA_UNKNOWN_RESOURCE",
    );
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", demand: {}, minGuarantee: { gpu: 1 } }] }),
      "MARA_UNKNOWN_RESOURCE",
    );
  });

  test("rejects negative amounts", () => {
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", demand: { cpu: -1 } }] }),
      "MARA_NEGATIVE_AMOUNT",
    );
  });

  test("rejects non-finite numbers", () => {
    expectCode(
      () => normalizeFleet({ resources: { cpu: Number.NaN }, agents: [{ id: "a", demand: {} }] }),
      "MARA_NON_FINITE",
    );
    expectCode(
      () => normalizeFleet({ resources: { cpu: 1 }, agents: [{ id: "a", demand: { cpu: "2" } }] }),
      "MARA_NON_FINITE",
    );
  });

  test("rejects guarantees exceeding capacity in aggregate", () => {
    expectCode(
      () =>
        normalizeFleet({
          resources: { cpu: 4 },
          agents: [
            { id: "a", minGuarantee: { cpu: 3 }, demand: {} },
            { id: "b", minGuarantee: { cpu: 2 }, demand: {} },
          ],
        }),
      "MARA_GUARANTEE_EXCEEDS_CAPACITY",
    );
  });

  test("accepts guarantees within capacity", () => {
    expect(
      normalizeFleet({
        resources: { cpu: 6 },
        agents: [
          { id: "a", minGuarantee: { cpu: 3 }, demand: {} },
          { id: "b", minGuarantee: { cpu: 2 }, demand: {} },
        ],
      }),
    ).toBeDefined();
  });
});
