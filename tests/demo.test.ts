import { describe, expect, test } from "bun:test";
import { runDemo } from "../src/demo.js";

describe("runDemo", () => {
  test("is byte-identical across runs", () => {
    expect(runDemo()).toBe(runDemo());
  });

  test("covers every demo agent and resource", () => {
    const report = runDemo();
    for (const agentId of ["batch-embed", "chat", "eval", "ingest", "research"]) {
      expect(report).toContain(agentId);
    }
    for (const resId of ["api_quota", "cpu", "gpu", "memory"]) {
      expect(report).toContain(resId);
    }
  });

  test("shows the gpu contention outcome", () => {
    const report = runDemo();
    expect(report).toContain("insufficient gpu");
  });
});
