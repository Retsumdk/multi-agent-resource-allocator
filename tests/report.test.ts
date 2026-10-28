import { describe, expect, test } from "bun:test";
import { allocate } from "../src/drf.js";
import { renderReport } from "../src/report.js";

const FLEET = {
  resources: { cpu: 10 },
  agents: [
    { id: "a", demand: { cpu: 10 } },
    { id: "b", demand: { cpu: 10 } },
  ],
};

describe("renderReport", () => {
  test("renders resource and agent tables with the fairness line", () => {
    const report = renderReport(allocate(FLEET));
    expect(report).toContain("RESOURCE");
    expect(report).toContain("CAPACITY");
    expect(report).toContain("AGENT");
    expect(report).toContain("a");
    expect(report).toContain("b");
    expect(report).toContain("%");
    expect(report).toContain("fairness (Jain index over dominant shares):");
    expect(report).toContain("agents fully served:");
    expect(report).toContain("grants issued:");
  });

  test("never emits NaN, undefined, or negative-zero in text output", () => {
    const report = renderReport(
      allocate({
        resources: { cpu: 4, gpu: 0 },
        agents: [{ id: "a", demand: { cpu: 2, gpu: 1 } }],
      }),
    );
    expect(report).not.toContain("NaN");
    expect(report).not.toContain("undefined");
    expect(report).not.toContain("-0");
  });

  test("json mode round-trips through JSON.parse", () => {
    const parsed = JSON.parse(renderReport(allocate(FLEET), true)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["allocations", "fairness", "grants", "resources"]);
    const allocations = parsed["allocations"] as Array<Record<string, unknown>>;
    expect(allocations).toHaveLength(2);
  });

  test("every utilization is a number in [0, 1]", () => {
    const result = allocate(FLEET);
    for (const row of result.resources) {
      expect(row.utilization).toBeGreaterThanOrEqual(0);
      expect(row.utilization).toBeLessThanOrEqual(1);
    }
  });
});
