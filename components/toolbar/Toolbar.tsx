"use client";

import { useRef } from "react";
import {
  Save,
  FolderOpen,
  Download,
  PanelLeft,
  Trash2,
  Plus,
  Cloud,
  FileDown,
  Braces,
  Upload,
  Terminal,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  architectureName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onLoad: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
  onExportJson: () => void;
  onImportJson: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerateTerraform: () => void;
  onShare: () => void;
  onNew: () => void;
  onClear: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  isSaving?: boolean;
  isSharingCloud?: boolean;
  hasUnsavedChanges?: boolean;
}

export function Toolbar({
  architectureName,
  onNameChange,
  onSave,
  onLoad,
  onExportPng,
  onExportPdf,
  onExportJson,
  onImportJson,
  onGenerateTerraform,
  onShare,
  onNew,
  onClear,
  onToggleSidebar,
  sidebarOpen,
  isSaving,
  isSharingCloud,
  hasUnsavedChanges,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <header className="no-export flex h-14 shrink-0 flex-wrap items-center gap-2 border-b border-[#21262d] bg-[#0d1117] px-4 py-2 sm:gap-3">
      {/* Sidebar Toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className={cn(
          "rounded-lg p-2 text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]",
          sidebarOpen && "bg-[#21262d] text-[#f0f6fc]"
        )}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      {/* Brand Identity */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff9900]">
          <Cloud className="h-4 w-4 text-[#0d1117]" />
        </div>
        <div className="hidden md:block">
          <p className="text-xs font-medium text-[#8b949e]">AWS Architecture Designer</p>
        </div>
      </div>

      <div className="mx-2 hidden h-6 w-px bg-[#21262d] md:block" />

      {/* Architecture Name Input */}
      <input
        type="text"
        value={architectureName}
        onChange={(e) => onNameChange(e.target.value)}
        className="max-w-[150px] rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-[#f0f6fc] outline-none hover:border-[#30363d] focus:border-[#ff9900] sm:max-w-xs"
        placeholder="Architecture name"
      />

      {hasUnsavedChanges && (
        <span className="rounded-full bg-[#ff990022] px-2 py-0.5 text-[10px] font-medium text-[#ff9900]">
          Unsaved
        </span>
      )}

      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onImportJson}
        className="hidden"
      />

      {/* Toolbar actions panel */}
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <ToolbarButton icon={Plus} label="New" onClick={onNew} />
        <ToolbarButton icon={FolderOpen} label="Load" onClick={onLoad} />
        <ToolbarButton
          icon={Save}
          label={isSaving ? "Saving..." : "Save"}
          onClick={onSave}
          variant="primary"
        />

        <div className="mx-1 h-5 w-px bg-[#21262d]" />

        {/* Import */}
        <ToolbarButton icon={Upload} label="Import JSON" onClick={handleImportClick} />

        {/* Exports */}
        <ToolbarButton icon={Download} label="PNG" onClick={onExportPng} />
        <ToolbarButton icon={FileDown} label="PDF" onClick={onExportPdf} />
        <ToolbarButton icon={Braces} label="JSON" onClick={onExportJson} />

        <div className="mx-1 h-5 w-px bg-[#21262d]" />

        {/* Cloud S3 Share */}
        <ToolbarButton
          icon={Globe}
          label={isSharingCloud ? "Sharing..." : "Share to Cloud"}
          onClick={onShare}
          variant="success"
        />

        {/* Infrastructure Generation */}
        <ToolbarButton
          icon={Terminal}
          label="Terraform"
          onClick={onGenerateTerraform}
          variant="tertiary"
        />

        <ToolbarButton icon={Trash2} label="Clear" onClick={onClear} variant="danger" />
      </div>
    </header>
  );
}

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  variant?: "default" | "primary" | "tertiary" | "success" | "danger";
}

function ToolbarButton({ icon: Icon, label, onClick, variant = "default" }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
        variant === "default" &&
          "text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]",
        variant === "primary" &&
          "bg-[#ff9900] text-[#0d1117] hover:bg-[#e88b00]",
        variant === "tertiary" &&
          "bg-[#8C4FFF] text-white hover:bg-[#783bdc]",
        variant === "success" &&
          "bg-[#2ea043] text-white hover:bg-[#2c973f]",
        variant === "danger" &&
          "text-[#f85149] hover:bg-[#f8514911]"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
