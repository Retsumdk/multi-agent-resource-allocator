# multi-agent-resource-allocator

Optimizes resource allocation across the agent fleet including CPU, memory, API quotas, and compute capacity.

A weighted, multi-resource allocator for fleets of AI agents. It answers the question every fleet operator eventually faces: when agents demand more than the fleet has, who gets cut, by how much, and who is protected?

[![CI](https://github.com/Retsumdk/multi-agent-resource-allocator/actions/workflows/ci.yml/badge.svg)](https://github.com/Retsumdk/multi-agent-resource-allocator/actions/workflows/ci.yml)

## The problem

Agent fleets consume heterogeneous resources — CPU seconds, resident memory, API rate-limit quota, GPU capacity — and the demands are lopsided: an ingestion agent eats CPU and memory, a research agent eats API quota, an evaluation agent eats GPU. Splitting every pool evenly wastes capacity on idle agents and starves critical ones. Ad-hoc fixes (first-come-first-served, hardcoded caps) are silent failure factories: one agent's runaway demand quietly degrades every other agent, and nobody can say who lost what.

The classic answer from cluster schedulers is **Dominant Resource Fairness (DRF)** — the allocation scheme behind Mesos and YARN. It generalizes max-min fairness to multiple resources by comparing each agent's *dominant share*: the largest fraction of any single resource it holds. This package implements weighted DRF with hard minimum guarantees, as a small deterministic library with zero runtime dependencies.

## What you get

- **Weighted DRF allocation** across any number of named resources. Higher-weight agents earn proportionally larger dominant shares; equal weights end at (approximately) equal dominant shares.
- **Minimum guarantees** reserved per agent before fair sharing starts — a latency-critical router keeps its CPU and API floor even when a greedy batch job demands everything.
- **A decision record, not just numbers**: every agent reports `allocated` vs `demanded` per resource, a status (`allocated` / `partial` / `blocked`), and the resource that bound it (`insufficient gpu`). Leftover capacity and utilization are reported per resource.
- **A fairness metric** — the Jain index over dominant shares — so you can watch fairness regress across config changes.
- **Determinism**: allocation is a pure function of the spec. Agent order in the input does not matter; identical specs produce byte-identical output, which makes fleet allocations diffable and testable.
- **A CLI** (`mara`) and an importable library, both fully typed (strict TypeScript, no `any` in `src`).

## How it works

Each agent declares a `demand` per resource, an optional `weight` (default 1), and an optional `minGuarantee`.

1. **Reservation pass.** Every agent's guarantee is granted first. Guarantees are validated in aggregate: the sum of guarantees on a resource must not exceed its capacity.
2. **Fair-share pass.** The remaining capacity is shared by weighted DRF. Each agent's demand is divided into `stepsPerDemand` equal chunks (default 64). In every round the agent with the lowest *dominant share ÷ weight* receives its next chunk on **all** demanded resources at once (grants are atomic across resources, the same way a scheduler assigns a task that needs CPU *and* memory *and* quota together). Ties break by agent id.
3. **Termination.** The loop stops when every agent is fully served or when no agent's next chunk fits. What remains is reported as leftover, so stranded capacity is visible instead of hidden.

The dominant share of an agent is `max(allocated[r] / capacity[r])` over resources with positive capacity. A weight-2 agent therefore converges to roughly twice the dominant share of a weight-1 agent when both are contending. Fully served agents stop participating, so light agents never block heavy ones.

**Granularity note:** because grants are atomic chunks, an agent whose binding resource is exhausted stops receiving allocations on its *other* resources too — it cannot use memory it cannot put to work without quota. Up to one chunk (< demand / 64) of capacity can strand per agent; raise `--steps` for finer granularity.

## Getting started

Requires Node 18.17+ or Bun 1.1+. Zero runtime dependencies.

```bash
git clone https://github.com/Retsumdk/multi-agent-resource-allocator.git
cd multi-agent-resource-allocator
bun install
bun test          # 57 tests
bun src/cli.ts demo
```

Install as a library from GitHub (the package builds itself on install via `prepare`):

```bash
npm install github:Retsumdk/multi-agent-resource-allocator
```

Bun users: Bun blocks lifecycle scripts of git dependencies by default, so follow the install with `bun pm trust multi-agent-resource-allocator` — or use npm, which runs `prepare` automatically.

## CLI

### `mara demo`

Allocates a built-in five-agent fleet (ingestion, research, evaluation, chat, batch embedding) contending for CPU, memory, API quota, and GPU:

```text
FLEET ALLOCATION

RESOURCE    CAPACITY   RESERVED   ALLOCATED   LEFTOVER   UTILIZATION
api_quota      12000        400      8615.6     3384.4         71.8%
cpu               64          4        53.3       10.8         83.2%
gpu                8          0           8          0        100.0%
memory           256         16         218         38         85.2%

AGENT         WEIGHT   DOMINANT SHARE   ALLOCATION (granted/demanded)                                  STATUS
batch-embed      0.5           0.2969   api_quota 534.4/900, cpu 11.9/20, gpu 2.38/4, memory 28.5/48   partial - insufficient gpu
chat               2           0.1250   api_quota 1200/1200, cpu 8/8, memory 32/32                     allocated (guarantee honored)
eval            1.25           0.7031   api_quota 281.3/300, cpu 9.38/10, gpu 5.63/6, memory 37.5/40   partial - insufficient gpu
ingest           1.5           0.3750   api_quota 600/600, cpu 16/16, memory 96/96                     allocated
research           1           0.5000   api_quota 6000/6000, cpu 8/8, memory 24/24                     allocated

fairness (Jain index over dominant shares): 0.8091
agents fully served: 3/5
grants issued: 269
```

Read the story in the table: `chat` is fully served and its guarantee is honored despite the lowest weight-adjusted share; the GPU is the binding resource for both `eval` and `batch-embed`; and 3,384 requests/min of API quota is left on the table because no agent can use it without also getting the GPU it needs.

### `mara allocate`

Give it a fleet spec:

```json
{
  "resources": { "cpu": 32, "memory": 128, "api_quota": 5000 },
  "agents": [
    { "id": "summarize", "weight": 1.5, "demand": { "cpu": 8, "memory": 32, "api_quota": 2400 } },
    { "id": "indexer", "weight": 1, "demand": { "cpu": 12, "memory": 64, "api_quota": 200 } },
    { "id": "router", "weight": 2, "minGuarantee": { "cpu": 2, "api_quota": 500 }, "demand": { "cpu": 4, "memory": 8, "api_quota": 4000 } }
  ]
}
```

```text
$ mara allocate --file pipeline.json

FLEET ALLOCATION

RESOURCE    CAPACITY   RESERVED   ALLOCATED   LEFTOVER   UTILIZATION
api_quota       5000        500        5000          0        100.0%
cpu               32          2        17.9       14.1         55.9%
memory           128          0          69         59         53.9%

AGENT       WEIGHT   DOMINANT SHARE   ALLOCATION (granted/demanded)                       STATUS
indexer          1           0.2813   api_quota 112.5/200, cpu 6.75/12, memory 36/64      partial - insufficient api_quota
router           2           0.5500   api_quota 2750/4000, cpu 4/4, memory 4.5/8          partial (guarantee honored) - insufficient api_quota
summarize      1.5           0.4275   api_quota 2137.5/2400, cpu 7.13/8, memory 28.5/32   partial - insufficient api_quota

fairness (Jain index over dominant shares): 0.9358
agents fully served: 0/3
grants issued: 129
```

API quota is the bottleneck: all 5,000 requests/min are allocated, CPU and memory sit at ~55% utilization, and `router`'s guarantee (500 quota, 2 CPU) was reserved before fair sharing began. Note that `router` holds only 4.5 of its 8 GB memory demand — its quota is exhausted, and grants are atomic, so idle memory is not handed to an agent that cannot use it. Add `--json` for machine-readable output, or `--steps 256` for finer grant granularity.

## Library usage

```ts
import { allocate } from "multi-agent-resource-allocator";

const result = allocate({
  resources: { cpu: 32, memory: 128, api_quota: 5000 },
  agents: [
    { id: "summarize", weight: 1.5, demand: { cpu: 8, memory: 32, api_quota: 2400 } },
    { id: "indexer", weight: 1, demand: { cpu: 12, memory: 64, api_quota: 200 } },
    { id: "router", weight: 2, minGuarantee: { cpu: 2, api_quota: 500 }, demand: { cpu: 4, memory: 8, api_quota: 4000 } },
  ],
}, { stepsPerDemand: 64 });

for (const entry of result.allocations) {
  console.log(entry.agentId, entry.status, entry.dominantShare, entry.reason ?? "");
}
console.log(result.fairness, result.grants);
```

Invalid specs throw a `MaraError` with a stable `code` (see below) before any allocation runs.

## Fleet spec format

```ts
interface FleetSpec {
  resources: Record<string, number>;       // capacity per resource, >= 0
  agents: Array<{
    id: string;                            // unique
    weight?: number;                       // default 1, must be > 0
    demand: Record<string, number>;        // amounts per known resource, >= 0
    minGuarantee?: Record<string, number>; // reserved before fair sharing
  }>;
}
```

Validation rules (fail fast, all reported as `MaraError` with exit code 3 from the CLI):

- the spec must be an object with a `resources` object and a non-empty `agents` array;
- capacities, weights, demands, and guarantees must be finite, non-negative numbers;
- demands and guarantees may only reference resources that exist in the pool;
- the aggregate guarantee on any resource must not exceed its capacity.

Zero-amount demand entries are dropped. Agents are processed in sorted-id order, so input order never changes the outcome.

### CLI exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | success |
| 1 | internal error |
| 2 | usage error (unknown command/option, missing `--file`) |
| 3 | invalid fleet spec (`MARA_*` validation error) |
| 4 | fleet file not readable |
| 5 | fleet file is not valid JSON |

## Design notes

- **Why weighted DRF?** Per-resource max-min fairness treats each pool independently and can give one agent dominant shares of several resources at once; DRF allocates against the single most-contended share, which is what actually limits an agent. Weighting makes priority explicit instead of hidden in demand sizes.
- **Determinism by construction.** No wall-clock reads, no randomness, stable tie-breaking. The same spec allocates identically on every machine — CI re-runs the demo and diffs the output.
- **Guarantees are hard, not advisory.** They are subtracted from capacity before fair sharing, and they count toward an agent's dominant share.
- **What this is not.** It is a one-shot allocator over fixed demands, not a streaming task scheduler: there is no preemption, no queueing, and no multi-round bidding. If your fleet's demands change per tick, re-run `allocate` and diff the reports.

## License

MIT — see [LICENSE](LICENSE).

Built by [Retsumdk](https://github.com/Retsumdk)
