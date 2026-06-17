"use client";

import { useState } from "react";
import { GripVertical, Layers, LayoutTemplate, HelpCircle } from "lucide-react";
import { AwsServiceIcon } from "@/components/icons/aws";
import type { AwsComponentDefinition } from "@/types";
import { CATEGORY_LABELS, getComponentsByCategory } from "@/lib/aws-components";
import { DRAG_DATA_TYPE } from "@/lib/constants";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";

interface ComponentSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onSelectTemplate?: (templateId: string) => void;
}

function DraggableComponent({ component }: { component: AwsComponentDefinition }) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_DATA_TYPE, component.type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group flex cursor-grab items-center gap-3 rounded-lg border border-transparent bg-[#161b22] p-3 transition-all hover:border-[#30363d] hover:bg-[#1c2128] active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4 shrink-0 text-[#484f58] opacity-0 transition-opacity group-hover:opacity-100" />
      <AwsServiceIcon service={component.type} size={32} className="shrink-0 drop-shadow-sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#f0f6fc]">{component.label}</p>
        <p className="truncate text-[10px] text-[#8b949e]">{component.description}</p>
      </div>
    </div>
  );
}

export function ComponentSidebar({ collapsed, onToggle, onSelectTemplate }: ComponentSidebarProps) {
  const [activeTab, setActiveTab] = useState<"services" | "templates">("services");
  const grouped = getComponentsByCategory();

  return (
    <aside
      className={cn(
        "no-export flex shrink-0 flex-col border-r border-[#21262d] bg-[#0d1117] transition-all duration-300",
        collapsed ? "w-0 overflow-hidden opacity-0" : "w-72 opacity-100"
      )}
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between border-b border-[#21262d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[#f0f6fc]">Cloud Designer</h2>
          <p className="text-[10px] text-[#8b949e]">Deploy and visualize services</p>
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc] lg:hidden"
            aria-label="Close sidebar"
          >
            ×
          </button>
        )}
      </div>

      {/* Switcher Tab bar */}
      <div className="flex border-b border-[#21262d] bg-[#161b22]/30">
        <button
          type="button"
          onClick={() => setActiveTab("services")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "services"
              ? "border-[#ff9900] text-[#ff9900]"
              : "border-transparent text-[#8b949e] hover:text-[#f0f6fc]"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Services</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("templates")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "templates"
              ? "border-[#ff9900] text-[#ff9900]"
              : "border-transparent text-[#8b949e] hover:text-[#f0f6fc]"
          }`}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          <span>Templates</span>
        </button>
      </div>

      {/* Content panel */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "services" ? (
          Object.entries(grouped).map(([category, components]) => (
            <div key={category} className="mb-5">
              <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-[#484f58]">
                {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}
              </h3>
              <div className="space-y-2">
                {components.map((component) => (
                  <DraggableComponent key={component.type} component={component} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-3">
            <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#484f58]">
              Predefined Architectures
            </h3>
            {ARCHITECTURE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelectTemplate?.(template.id)}
                className="w-full text-left group flex flex-col gap-2 rounded-lg border border-[#21262d] bg-[#161b22] p-3 transition-all hover:border-[#ff990022] hover:bg-[#1c2128] focus:border-[#ff9900]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#f0f6fc] group-hover:text-[#ff9900]">
                    {template.name}
                  </span>
                  <span className="rounded bg-[#ff990011] px-1.5 py-0.5 text-[9px] font-bold text-[#ff9900]">
                    Template
                  </span>
                </div>
                <p className="text-xs text-[#8b949e] line-clamp-2 leading-relaxed">
                  {template.description}
                </p>
                <div className="flex items-center gap-2 mt-1 border-t border-[#21262d]/50 pt-2 text-[10px] text-[#484f58]">
                  <span>{template.nodes.length} nodes</span>
                  <span>·</span>
                  <span>{template.edges.length} connections</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[#21262d] p-3 bg-[#161b22]/20">
        <div className="flex items-center gap-2 text-xs text-[#8b949e]">
          <HelpCircle className="h-3.5 w-3.5 shrink-0 text-[#ff9900]" />
          <p className="leading-snug">
            {activeTab === "services"
              ? "Tip: Drag components onto the grid and draw arrows between handles."
              : "Tip: Loading a template will overwrite your current active canvas."}
          </p>
        </div>
      </div>
    </aside>
  );
}
