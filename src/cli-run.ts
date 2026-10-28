import { readFileSync } from "node:fs";
import { demoFleet } from "./demo.js";
import { allocate } from "./drf.js";
import { MaraError } from "./errors.js";
import { renderReport } from "./report.js";
import { VERSION } from "./version.js";

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const EXIT_INTERNAL = 1;
const EXIT_USAGE = 2;
const EXIT_FILE = 4;
const EXIT_PARSE = 5;

const USAGE = `mara ${VERSION} - weighted multi-resource allocator for agent fleets

Usage:
  mara demo [--json]
  mara allocate --file <fleet.json> [--steps <n>] [--json]
  mara version
  mara help

Commands:
  demo        Allocate the built-in example fleet and print the report
  allocate    Allocate a fleet described by a JSON file ("-" reads stdin)
  version     Print the version
  help        Show this help

Options:
  --file, -f   Path to the fleet spec JSON ("-" reads stdin)
  --steps      Grant steps per demand; higher is finer (default 64, max 4096)
  --json       Machine-readable output
  --help, -h   Show help

Exit codes:
  0 success
  1 internal error
  2 usage error
  3 invalid fleet spec
  4 file not found
  5 invalid JSON
`;

class UsageError extends Error {}

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  const valueFlags = new Set(["--file", "-f", "--steps"]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--help" || token === "-h") {
      flags.set("help", true);
      continue;
    }
    if (token === "--json") {
      flags.set("json", true);
      continue;
    }
    if (valueFlags.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${token} requires a value`);
      flags.set(token === "-f" ? "--file" : token, value);
      i += 1;
      continue;
    }
    if (token.startsWith("-") && token.length > 1) throw new UsageError(`unknown option '${token}'`);
    positional.push(token);
  }
  const command = positional.shift() ?? "";
  if (positional.length > 0) throw new UsageError(`unexpected argument '${positional[0]}'`);
  return { command, flags };
}

function asIntFlag(flags: Map<string, string | boolean>, name: string): number | undefined {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new UsageError(`${name} requires an integer value`);
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new UsageError(`${name} must be an integer, got '${raw}'`);
  return value;
}

export function runCli(argv: readonly string[]): CliResult {
  try {
    const { command, flags } = parseArgs(argv);

    if (flags.has("help")) {
      if (command !== "" && !["help", "demo", "allocate", "version"].includes(command)) {
        throw new UsageError(`unknown command '${command}'`);
      }
      return { code: 0, stdout: USAGE, stderr: "" };
    }

    switch (command) {
      case "help":
        return { code: 0, stdout: USAGE, stderr: "" };
      case "version":
        return { code: 0, stdout: `mara ${VERSION}\n`, stderr: "" };
      case "demo":
        return {
          code: 0,
          stdout: renderReport(allocate(demoFleet()), flags.has("json")),
          stderr: "",
        };
      case "allocate": {
        const file = flags.get("--file");
        if (typeof file !== "string" || file.length === 0) {
          throw new UsageError("allocate requires --file <fleet.json>");
        }
        const steps = asIntFlag(flags, "--steps");
        let raw: string;
        if (file === "-") {
          raw = readFileSync(0, "utf-8");
        } else {
          try {
            raw = readFileSync(file, "utf-8");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { code: EXIT_FILE, stdout: "", stderr: `mara: cannot read '${file}': ${message}\n` };
          }
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { code: EXIT_PARSE, stdout: "", stderr: `mara: invalid JSON in '${file}': ${message}\n` };
        }
        const options = steps === undefined ? undefined : { stepsPerDemand: steps };
        return {
          code: 0,
          stdout: renderReport(allocate(parsed, options), flags.has("json")),
          stderr: "",
        };
      }
      case "":
        return {
          code: EXIT_USAGE,
          stdout: "",
          stderr: "mara: expected a command (demo, allocate, version, help). Try 'mara help'.\n",
        };
      default:
        throw new UsageError(`unknown command '${command}'`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return { code: EXIT_USAGE, stdout: "", stderr: `mara: ${err.message}\n\n${USAGE}` };
    }
    if (err instanceof MaraError) {
      return { code: err.exitCode, stdout: "", stderr: `mara: ${err.code}: ${err.message}\n` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { code: EXIT_INTERNAL, stdout: "", stderr: `mara: unexpected error: ${message}\n` };
  }
}
