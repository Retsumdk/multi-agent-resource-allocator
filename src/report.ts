import type { AgentAllocation, AllocationResult, ResourceSummary } from "./types.js";

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function fmtAmount(n: number): string {
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return trimZeros(n.toFixed(digits));
}

function fmtShare(n: number): string {
  return n.toFixed(4);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderTable(headers: string[], aligns: Array<"left" | "right">, rows: string[][]): string {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => (aligns[i] === "right" ? padStart(cell, widths[i] ?? 0) : padEnd(cell, widths[i] ?? 0)))
      .join("   ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

function allocationCell(allocation: AgentAllocation): string {
  const resources = Object.keys(allocation.demand).sort();
  if (resources.length === 0) return "-";
  return resources
    .map((resId) => `${resId} ${fmtAmount(allocation.allocated[resId] ?? 0)}/${fmtAmount(allocation.demand[resId] ?? 0)}`)
    .join(", ");
}

function statusCell(allocation: AgentAllocation): string {
  const guaranteed = Object.keys(allocation.minGuarantee).length > 0;
  const suffix = guaranteed ? " (guarantee honored)" : "";
  const reason = allocation.reason ? ` - ${allocation.reason}` : "";
  return `${allocation.status}${suffix}${reason}`;
}

export function renderReport(result: AllocationResult, json = false): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;

  const resourceTable = renderTable(
    ["RESOURCE", "CAPACITY", "RESERVED", "ALLOCATED", "LEFTOVER", "UTILIZATION"],
    ["left", "right", "right", "right", "right", "right"],
    result.resources.map((row: ResourceSummary) => [
      row.resourceId,
      fmtAmount(row.capacity),
      fmtAmount(row.reserved),
      fmtAmount(row.allocated),
      fmtAmount(row.leftover),
      fmtPct(row.utilization),
    ]),
  );

  const agentTable = renderTable(
    ["AGENT", "WEIGHT", "DOMINANT SHARE", "ALLOCATION (granted/demanded)", "STATUS"],
    ["left", "right", "right", "left", "left"],
    result.allocations.map((allocation: AgentAllocation) => [
      allocation.agentId,
      fmtAmount(allocation.weight),
      fmtShare(allocation.dominantShare),
      allocationCell(allocation),
      statusCell(allocation),
    ]),
  );

  const served = result.allocations.filter((allocation) => allocation.status === "allocated").length;
  return [
    "FLEET ALLOCATION",
    "",
    resourceTable,
    "",
    agentTable,
    "",
    `fairness (Jain index over dominant shares): ${fmtShare(result.fairness)}`,
    `agents fully served: ${served}/${result.allocations.length}`,
    `grants issued: ${result.grants}`,
    "",
  ].join("\n");
}
