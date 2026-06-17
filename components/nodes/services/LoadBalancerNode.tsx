"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { LoadBalancerIcon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function LoadBalancerNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("load-balancer");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<LoadBalancerIcon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-2 top-1 opacity-[0.07]">
          <LoadBalancerIcon size={68} variant="glyph" className="text-[#8C4FFF]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div className="flex items-center justify-center gap-3 py-1">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.accent }} />
          <div className="flex gap-3">
            <div className="h-1.5 w-6 rounded" style={{ backgroundColor: theme.accent, opacity: 0.5 }} />
            <div className="h-1.5 w-6 rounded" style={{ backgroundColor: theme.accent, opacity: 0.7 }} />
            <div className="h-1.5 w-6 rounded" style={{ backgroundColor: theme.accent, opacity: 0.9 }} />
          </div>
        </div>
        <p className="mt-1 text-center text-[10px] text-[#484f58]">Traffic distribution</p>
      </div>
    </ServiceNodeShell>
  );
}

export const LoadBalancerNode = memo(LoadBalancerNodeComponent);
