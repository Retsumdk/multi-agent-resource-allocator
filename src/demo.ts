import { allocate } from "./drf.js";
import { renderReport } from "./report.js";

export function demoFleet(): Record<string, unknown> {
  return {
    resources: { cpu: 64, memory: 256, api_quota: 12000, gpu: 8 },
    agents: [
      { id: "batch-embed", weight: 0.5, demand: { cpu: 20, memory: 48, api_quota: 900, gpu: 4 } },
      {
        id: "chat",
        weight: 2,
        minGuarantee: { cpu: 4, memory: 16, api_quota: 400 },
        demand: { cpu: 8, memory: 32, api_quota: 1200 },
      },
      { id: "eval", weight: 1.25, demand: { cpu: 10, memory: 40, api_quota: 300, gpu: 6 } },
      { id: "ingest", weight: 1.5, demand: { cpu: 16, memory: 96, api_quota: 600 } },
      { id: "research", weight: 1, demand: { cpu: 8, memory: 24, api_quota: 6000 } },
    ],
  };
}

export function runDemo(): string {
  return renderReport(allocate(demoFleet()));
}
