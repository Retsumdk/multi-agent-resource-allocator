import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli-run.js";

const dir = mkdtempSync(join(tmpdir(), "mara-cli-test-"));
const fleetPath = join(dir, "fleet.json");
writeFileSync(
  fleetPath,
  JSON.stringify({
    resources: { cpu: 4 },
    agents: [{ id: "worker", demand: { cpu: 4 } }],
  }),
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runCli", () => {
  test("help exits 0 and prints usage", () => {
    const result = runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  test("no command is a usage error", () => {
    const result = runCli([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("expected a command");
  });

  test("unknown command is a usage error", () => {
    const result = runCli(["frobnicate"]);
    expect(result.code).toBe(2);
  });

  test("unknown option is a usage error", () => {
    const result = runCli(["demo", "--wat"]);
    expect(result.code).toBe(2);
  });

  test("demo exits 0 and prints a report", () => {
    const result = runCli(["demo"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("fairness (Jain index over dominant shares):");
  });

  test("demo --json emits parseable JSON", () => {
    const result = runCli(["demo", "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed["allocations"]).toBeArray();
  });

  test("allocate reads a fleet file and exits 0", () => {
    const result = runCli(["allocate", "--file", fleetPath]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("worker");
  });

  test("allocate supports the -f shorthand and --steps", () => {
    const result = runCli(["allocate", "-f", fleetPath, "--steps", "8"]);
    expect(result.code).toBe(0);
  });

  test("allocate without --file is a usage error", () => {
    const result = runCli(["allocate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--file");
  });

  test("allocate with a missing file exits 4", () => {
    const result = runCli(["allocate", "--file", join(dir, "missing.json")]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("cannot read");
  });

  test("allocate with invalid JSON exits 5", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    const result = runCli(["allocate", "--file", bad]);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain("invalid JSON");
  });

  test("allocate with an invalid spec exits 3 with the error code", () => {
    const invalid = join(dir, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ resources: { cpu: -4 }, agents: [{ id: "a", demand: {} }] }));
    const result = runCli(["allocate", "--file", invalid]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("MARA_NEGATIVE_CAPACITY");
  });

  test("non-integer --steps is a usage error", () => {
    const result = runCli(["allocate", "--file", fleetPath, "--steps", "many"]);
    expect(result.code).toBe(2);
  });

  test("version prints the version", () => {
    const result = runCli(["version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^mara \d+\.\d+\.\d+\n$/);
  });
});
