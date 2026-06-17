"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { AwsNodeData } from "@/types";
import { S3Icon } from "@/components/icons/aws";
import { ServiceNodeShell } from "../shared/ServiceNodeShell";
import { getServiceTheme } from "../shared/service-theme";

function S3NodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AwsNodeData;
  const theme = getServiceTheme("s3");

  return (
    <ServiceNodeShell
      data={nodeData}
      selected={selected}
      theme={theme}
      icon={<S3Icon size={44} />}
      accentPattern={
        <div className="pointer-events-none absolute right-2 top-1 opacity-[0.07]">
          <S3Icon size={68} variant="glyph" className="text-[#569A31]" />
        </div>
      }
    >
      <div className="border-t border-[#21262d] px-4 py-2.5">
        <div className="space-y-1">
          {[100, 75, 50].map((width) => (
            <div
              key={width}
              className="h-1 rounded-full bg-[#569A31]"
              style={{ width: `${width}%`, opacity: width / 200 }}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[#484f58]">Object storage bucket</p>
      </div>
    </ServiceNodeShell>
  );
}

export const S3Node = memo(S3NodeComponent);
