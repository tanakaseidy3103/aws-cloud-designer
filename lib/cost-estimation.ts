/**
 * Cost estimation service.
 * Estimates monthly AWS costs based on architecture components.
 */

import type { CostEstimationInput } from "@/types";

export interface CostEstimateLineItem {
  componentType: string;
  label: string;
  monthlyCostUsd: number;
}

export interface CostEstimateResult {
  architectureId: string;
  region: string;
  lineItems: CostEstimateLineItem[];
  totalMonthlyUsd: number;
  estimatedAt: string;
}

const BASE_COSTS_USD: Record<string, number> = {
  ec2: 10,
  rds: 15,
  s3: 2,
  lambda: 1,
  "load-balancer": 5,
  cloudfront: 3,
};

export function estimateCost(input: CostEstimationInput): CostEstimateResult {
  const lineItems: CostEstimateLineItem[] = input.nodes.map((node) => ({
    componentType: node.data.componentType,
    label: node.data.label,
    monthlyCostUsd: BASE_COSTS_USD[node.data.componentType] ?? 0,
  }));

  return {
    architectureId: input.architectureId,
    region: input.region,
    lineItems,
    totalMonthlyUsd: lineItems.reduce((sum, item) => sum + item.monthlyCostUsd, 0),
    estimatedAt: new Date().toISOString(),
  };
}

export function isCostEstimationEnabled(): boolean {
  return true;
}
