"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { Ec2Icon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function Ec2NodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("ec2");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<Ec2Icon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-3 top-2 opacity-[0.07]">
          <Ec2Icon size={64} variant="glyph" className="text-[#FF9900]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{ backgroundColor: theme.accent, opacity: 0.3 + i * 0.2 }}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[#484f58]">Virtual server instance</p>
      </div>
    </ServiceNodeShell>
  );
}

export const Ec2Node = memo(Ec2NodeComponent);
