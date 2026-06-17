"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { RdsIcon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function RdsNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("rds");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<RdsIcon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-2 top-1 opacity-[0.07]">
          <RdsIcon size={68} variant="glyph" className="text-[#3B48CC]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ backgroundColor: theme.accent }}
          />
          <p className="text-[10px] text-[#484f58]">Managed relational database</p>
        </div>
        <div className="mt-2 flex gap-1">
          {["Primary", "Replica"].map((label) => (
            <span
              key={label}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium"
              style={{ backgroundColor: theme.accentMuted, color: theme.accent }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </ServiceNodeShell>
  );
}

export const RdsNode = memo(RdsNodeComponent);
