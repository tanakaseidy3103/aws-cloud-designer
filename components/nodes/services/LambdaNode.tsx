"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { LambdaIcon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function LambdaNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("lambda");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<LambdaIcon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-3 top-2 opacity-[0.07]">
          <LambdaIcon size={64} variant="glyph" className="text-[#FF9900]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div
          className="rounded-md px-2 py-1.5 font-mono text-[10px]"
          style={{ backgroundColor: "#0d1117", color: theme.accent }}
        >
          λ event-driven
        </div>
        <p className="mt-2 text-[10px] text-[#484f58]">Serverless compute function</p>
      </div>
    </ServiceNodeShell>
  );
}

export const LambdaNode = memo(LambdaNodeComponent);
