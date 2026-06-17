"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { AwsNodeData } from "@/types";
import { getComponentDefinition } from "@/lib/aws-components";
import { cn } from "@/lib/utils";
import type { ServiceTheme } from "./service-theme";

export interface ServiceNodeShellProps {
  data: AwsNodeData;
  selected?: boolean;
  theme: ServiceTheme;
  icon: ReactNode;
  children?: ReactNode;
  accentPattern?: ReactNode;
}

export function ServiceNodeShell({
  data,
  selected,
  theme,
  icon,
  children,
  accentPattern,
}: ServiceNodeShellProps) {
  const definition = getComponentDefinition(data.componentType);
  if (!definition) return null;

  return (
    <div
      className={cn(
        "group relative min-w-[200px] overflow-hidden rounded-xl border bg-[#161b22] shadow-lg transition-all duration-200",
        selected
          ? "border-[var(--node-accent)] shadow-[0_0_0_1px_var(--node-accent),0_12px_32px_var(--node-glow)]"
          : "border-[#30363d] hover:border-[#484f58] hover:shadow-xl"
      )}
      style={
        {
          "--node-accent": theme.accent,
          "--node-glow": theme.glow,
        } as React.CSSProperties
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!-left-1.5 !h-3.5 !w-3.5 !border-2 !border-[#30363d] !bg-[#21262d] transition-transform hover:!scale-125 hover:!border-[var(--node-accent)] hover:!bg-[var(--node-accent)]"
      />

      {/* Accent gradient header */}
      <div
        className="relative px-4 pb-3 pt-3.5"
        style={{
          background: `linear-gradient(135deg, ${theme.gradientFrom} 0%, ${theme.gradientTo} 70%)`,
        }}
      >
        {accentPattern}

        <div className="relative flex items-start gap-3">
          <div className="shrink-0 drop-shadow-md">{icon}</div>
          <div className="min-w-0 flex-1 pt-0.5">
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: theme.accentMuted, color: theme.accent }}
            >
              {theme.badge}
            </span>
            <p className="mt-1 truncate text-[11px] font-medium text-[#8b949e]">
              {definition.label}
            </p>
            <p className="truncate text-sm font-semibold leading-tight text-[#f0f6fc]">
              {data.label}
            </p>
          </div>
        </div>
      </div>

      {/* Service-specific body */}
      {children}

      {/* Metadata footer */}
      {(data.region || data.instanceType) && (
        <div
          className="space-y-1 border-t px-4 py-2.5"
          style={{ borderColor: theme.accentMuted }}
        >
          {data.region && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#8b949e]">Region</span>
              <span className="truncate font-mono text-[#c9d1d9]">{data.region}</span>
            </div>
          )}
          {data.instanceType && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#8b949e]">Type</span>
              <span className="truncate font-mono text-[#c9d1d9]">{data.instanceType}</span>
            </div>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!-right-1.5 !h-3.5 !w-3.5 !border-2 !border-[#30363d] !bg-[#21262d] transition-transform hover:!scale-125 hover:!border-[var(--node-accent)] hover:!bg-[var(--node-accent)]"
      />
    </div>
  );
}
