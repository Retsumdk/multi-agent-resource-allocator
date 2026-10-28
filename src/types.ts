export type ResourceAmounts = Readonly<Record<string, number>>;

export interface AgentSpec {
  readonly id: string;
  readonly weight?: number;
  readonly demand: ResourceAmounts;
  readonly minGuarantee?: ResourceAmounts;
}

export interface FleetSpec {
  readonly resources: ResourceAmounts;
  readonly agents: readonly AgentSpec[];
}

export type AgentStatus = "allocated" | "partial" | "blocked";

export interface AgentAllocation {
  readonly agentId: string;
  readonly weight: number;
  readonly demand: ResourceAmounts;
  readonly minGuarantee: ResourceAmounts;
  readonly allocated: ResourceAmounts;
  readonly dominantShare: number;
  readonly status: AgentStatus;
  readonly reason: string | undefined;
}

export interface ResourceSummary {
  readonly resourceId: string;
  readonly capacity: number;
  readonly reserved: number;
  readonly allocated: number;
  readonly leftover: number;
  readonly utilization: number;
}

export interface AllocationResult {
  readonly allocations: readonly AgentAllocation[];
  readonly resources: readonly ResourceSummary[];
  readonly fairness: number;
  readonly grants: number;
}

export interface AllocateOptions {
  /**
   * How many incremental grant steps each agent's demand is split into.
   * Higher values give finer fairness granularity at the cost of more
   * iterations. Must be an integer in [1, 4096]. Defaults to 64.
   */
  readonly stepsPerDemand?: number;
}
