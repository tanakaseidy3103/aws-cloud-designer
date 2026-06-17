"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { CloudFrontIcon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function CloudFrontNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("cloudfront");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<CloudFrontIcon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-2 top-1 opacity-[0.07]">
          <CloudFrontIcon size={68} variant="glyph" className="text-[#8C4FFF]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div className="flex items-center justify-between">
          {["US", "EU", "AP"].map((edge) => (
            <span
              key={edge}
              className="rounded px-1.5 py-0.5 text-[9px] font-bold"
              style={{ backgroundColor: theme.accentMuted, color: theme.accent }}
            >
              {edge}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[#484f58]">Global CDN distribution</p>
      </div>
    </ServiceNodeShell>
  );
}

export const CloudFrontNode = memo(CloudFrontNodeComponent);
