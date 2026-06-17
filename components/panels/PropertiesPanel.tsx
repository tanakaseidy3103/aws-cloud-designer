"use client";

import { useCallback, useEffect, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { Settings, DollarSign, Activity, AlertTriangle, XCircle, Info, CheckCircle2, Trash2 } from "lucide-react";
import type { AwsNodeData } from "@/types";
import { getComponentDefinition } from "@/lib/aws-components";
import { DEFAULT_REGION } from "@/lib/constants";
import { estimateCost } from "@/lib/cost-estimation";
import { validateArchitecture } from "@/lib/validation";

interface PropertiesPanelProps {
  nodeId: string | null;
  nodeData: AwsNodeData | null;
  onUpdate: (nodeId: string, data: Partial<AwsNodeData>) => void;
  onDelete: (nodeId: string) => void;
  collapsed?: boolean;
  nodes: Node<AwsNodeData>[];
  edges: Edge[];
}

type TabType = "properties" | "cost" | "health";

export function PropertiesPanel({
  nodeId,
  nodeData,
  onUpdate,
  onDelete,
  collapsed,
  nodes,
  edges,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("properties");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [instanceType, setInstanceType] = useState("");

  // Sync state with active node when selected
  useEffect(() => {
    if (nodeData) {
      setLabel(nodeData.label);
      setDescription(nodeData.description ?? "");
      setRegion(nodeData.region ?? DEFAULT_REGION);
      setInstanceType(nodeData.instanceType ?? "");
      setActiveTab("properties"); // Auto-switch to properties on selection
    }
  }, [nodeData, nodeId]);

  const handleApply = useCallback(() => {
    if (!nodeId) return;
    onUpdate(nodeId, {
      label: label.trim() || "Untitled",
      description: description.trim(),
      region,
      instanceType: instanceType.trim() || undefined,
    });
  }, [nodeId, label, description, region, instanceType, onUpdate]);

  if (collapsed) return null;

  const definition = nodeData ? getComponentDefinition(nodeData.componentType) : null;

  // Real-time calculations
  const costReport = estimateCost({
    architectureId: "canvas-estimate",
    nodes,
    region: nodes[0]?.data.region ?? DEFAULT_REGION,
  });

  const healthReport = validateArchitecture(nodes, edges);

  // Cost items breakdown
  const costBreakdown = costReport.lineItems.reduce<Record<string, { count: number; total: number }>>(
    (acc, item) => {
      const type = item.componentType;
      if (!acc[type]) {
        acc[type] = { count: 0, total: 0 };
      }
      acc[type].count += 1;
      acc[type].total += item.monthlyCostUsd;
      return acc;
    },
    {}
  );

  const componentLabels: Record<string, string> = {
    ec2: "Amazon EC2 Instances",
    rds: "Amazon RDS Databases",
    s3: "Amazon S3 Buckets",
    lambda: "AWS Lambda Functions",
    "load-balancer": "Elastic Load Balancers",
    cloudfront: "CloudFront CDN",
  };

  return (
    <aside className="no-export flex w-80 shrink-0 flex-col border-l border-[#21262d] bg-[#0d1117]">
      {/* Tab bar header */}
      <div className="flex border-b border-[#21262d] bg-[#161b22]/40">
        <TabButton
          icon={Settings}
          label="Properties"
          active={activeTab === "properties"}
          onClick={() => setActiveTab("properties")}
        />
        <TabButton
          icon={DollarSign}
          label="Estimates"
          active={activeTab === "cost"}
          onClick={() => setActiveTab("cost")}
        />
        <TabButton
          icon={Activity}
          label="Health"
          active={activeTab === "health"}
          onClick={() => setActiveTab("health")}
          badge={healthReport.warnings.length > 0 ? healthReport.warnings.length : undefined}
          badgeColor={healthReport.isValid ? "bg-[#2ea043]" : "bg-[#f85149]"}
        />
      </div>

      {/* Tab contents */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {activeTab === "properties" && (
          <div className="flex flex-1 flex-col">
            {!nodeId || !nodeData || !definition ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                <Settings className="h-10 w-10 text-[#484f58] mb-3" />
                <p className="text-sm font-medium text-[#c9d1d9]">No Node Selected</p>
                <p className="mt-1 text-xs text-[#8b949e]">
                  Click on an AWS service in the canvas topology to inspect and edit its properties here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: definition.color }}
                    />
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#f0f6fc]">
                      {definition.label}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-[#8b949e]">{definition.description}</p>
                </div>

                <div>
                  <label htmlFor="node-label" className="mb-1.5 block text-xs font-medium text-[#8b949e]">
                    Name / Identifier
                  </label>
                  <input
                    id="node-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={handleApply}
                    className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#f0f6fc] outline-none focus:border-[#ff9900] focus:ring-1 focus:ring-[#ff9900]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="node-description"
                    className="mb-1.5 block text-xs font-medium text-[#8b949e]"
                  >
                    Usage Description
                  </label>
                  <textarea
                    id="node-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleApply}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#f0f6fc] outline-none focus:border-[#ff9900] focus:ring-1 focus:ring-[#ff9900]"
                  />
                </div>

                <div>
                  <label htmlFor="node-region" className="mb-1.5 block text-xs font-medium text-[#8b949e]">
                    Deployment Region
                  </label>
                  <select
                    id="node-region"
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      if (nodeId) onUpdate(nodeId, { region: e.target.value });
                    }}
                    className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#f0f6fc] outline-none focus:border-[#ff9900]"
                  >
                    <option value="us-east-1">US East (N. Virginia)</option>
                    <option value="us-west-2">US West (Oregon)</option>
                    <option value="eu-west-1">EU (Ireland)</option>
                    <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                    <option value="sa-east-1">South America (São Paulo)</option>
                  </select>
                </div>

                {(nodeData.componentType === "ec2" || nodeData.componentType === "rds") && (
                  <div>
                    <label
                      htmlFor="node-instance-type"
                      className="mb-1.5 block text-xs font-medium text-[#8b949e]"
                    >
                      Resource Size / Instance Type
                    </label>
                    <input
                      id="node-instance-type"
                      type="text"
                      value={instanceType}
                      onChange={(e) => setInstanceType(e.target.value)}
                      onBlur={handleApply}
                      placeholder={nodeData.componentType === "ec2" ? "t3.medium" : "db.t3.micro"}
                      className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#f0f6fc] outline-none focus:border-[#ff9900] focus:ring-1 focus:ring-[#ff9900]"
                    />
                  </div>
                )}

                <div className="pt-6">
                  <button
                    type="button"
                    onClick={() => nodeId && onDelete(nodeId)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#f8514922] bg-[#f8514911] px-4 py-2 text-sm font-medium text-[#f85149] transition-colors hover:bg-[#f8514922]"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Component
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "cost" && (
          <div className="flex flex-1 flex-col">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] mb-3">
              Cost Summary
            </h3>

            {nodes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center py-8">
                <DollarSign className="h-8 w-8 text-[#484f58] mb-2" />
                <p className="text-sm font-medium text-[#c9d1d9]">No resources configured</p>
                <p className="text-xs text-[#8b949e] mt-1">Add components to generate pricing details.</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col space-y-4">
                <div className="rounded-xl border border-[#ff990022] bg-[#ff9900]/5 p-4 text-center">
                  <p className="text-xs font-medium text-[#ff9900] uppercase tracking-wide">
                    Total Estimated Cost
                  </p>
                  <p className="mt-1 text-3xl font-extrabold text-[#f0f6fc]">
                    ${costReport.totalMonthlyUsd.toFixed(2)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#8b949e]">
                    USD / Monthly rate (On-Demand)
                  </p>
                </div>

                <div className="rounded-lg border border-[#21262d] bg-[#161b22]/30 p-1">
                  <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#484f58] border-b border-[#21262d]">
                    Billing breakdown
                  </p>
                  <ul className="divide-y divide-[#21262d]">
                    {Object.entries(costBreakdown).map(([type, stats]) => (
                      <li key={type} className="flex items-center justify-between px-3 py-2.5 text-xs">
                        <div>
                          <p className="font-semibold text-[#f0f6fc]">
                            {componentLabels[type] || type.toUpperCase()}
                          </p>
                          <p className="text-[10px] text-[#8b949e]">Qty: {stats.count}</p>
                        </div>
                        <p className="font-mono font-bold text-[#c9d1d9]">
                          ${stats.total.toFixed(2)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-[#30363d] bg-[#161b22]/50 p-3 text-[10px] text-[#8b949e] leading-normal">
                  Note: Values shown are mock indicators modeled on basic regional estimates. Real cloud bills vary with actual data transfers, storage requests, and instance configurations.
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "health" && (
          <div className="flex flex-1 flex-col">
            <HealthGauge score={healthReport.healthScore} />

            <div className="mt-4 flex-1 space-y-4">
              {/* Warnings List */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-2">
                  Compliance Warnings ({healthReport.warnings.length})
                </h4>

                {healthReport.warnings.length === 0 ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-[#2ea04322] bg-[#2ea04311] p-3 text-xs text-[#2ea043]">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Diagram complies with all standard validation rules.</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {healthReport.warnings.map((warn) => (
                      <div
                        key={warn.id}
                        className={`flex gap-2.5 rounded-lg border p-2.5 text-xs ${
                          warn.type === "error"
                            ? "border-[#f8514922] bg-[#f8514911] text-[#f85149]"
                            : "border-[#d2992222] bg-[#d2992211] text-[#d29922]"
                        }`}
                      >
                        {warn.type === "error" ? (
                          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-semibold leading-snug">{warn.message}</p>
                          <p className="mt-1 text-[10px] opacity-80 leading-normal">
                            Rule: {warn.rule}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recommendations List */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-2">
                  Actionable Recommendations
                </h4>

                {healthReport.recommendations.length === 0 ? (
                  <p className="text-xs text-[#484f58] italic">No active optimization items.</p>
                ) : (
                  <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                    {healthReport.recommendations.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex gap-2.5 rounded-lg border border-[#30363d] bg-[#161b22] p-2.5 text-xs text-[#c9d1d9]"
                      >
                        <Info className="h-4 w-4 text-[#8C4FFF] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">{rec.message}</p>
                          <p className="mt-0.5 text-[10px] text-[#8b949e]">{rec.action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// Sub-components

interface TabButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: string;
}

function TabButton({ icon: Icon, label, active, onClick, badge, badgeColor = "bg-[#ff9900]" }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-xs font-semibold transition-colors ${
        active
          ? "border-[#ff9900] text-[#ff9900]"
          : "border-transparent text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#161b22]/20"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined && (
        <span className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${badgeColor}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function HealthGauge({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let strokeColor = "#2ea043"; // green
  if (score < 50) strokeColor = "#f85149"; // red
  else if (score < 80) strokeColor = "#d29922"; // amber

  return (
    <div className="flex flex-col items-center justify-center border-b border-[#21262d]/60 pb-4">
      <div className="relative flex items-center justify-center">
        <svg className="h-20 w-20 transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={radius}
            className="stroke-[#21262d]"
            strokeWidth="5.5"
            fill="transparent"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            stroke={strokeColor}
            strokeWidth="5.5"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <span className="absolute text-lg font-extrabold text-[#f0f6fc]">{score}</span>
      </div>
      <p className="mt-1.5 text-[10px] font-semibold text-[#8b949e] uppercase tracking-wide">
        Health & Compliance Score
      </p>
    </div>
  );
}
