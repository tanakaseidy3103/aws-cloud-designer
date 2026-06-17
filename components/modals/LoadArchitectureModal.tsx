"use client";

import { useCallback } from "react";
import { X, FolderOpen, Trash2, RefreshCw } from "lucide-react";
import type { ArchitectureMetadata } from "@/types";
import { deleteArchitecture } from "@/lib/storage";
import { formatDate } from "@/lib/utils";

interface LoadArchitectureModalProps {
  open: boolean;
  architectures: ArchitectureMetadata[];
  onClose: () => void;
  onLoad: (id: string) => void;
  onRefresh: () => void;
}

export function LoadArchitectureModal({
  open,
  architectures,
  onClose,
  onLoad,
  onRefresh,
}: LoadArchitectureModalProps) {
  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
      deleteArchitecture(id);
      onRefresh();
    },
    [onRefresh]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="load-modal-title"
        className="relative z-10 w-full max-w-lg rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#21262d] px-5 py-4">
          <div>
            <h2 id="load-modal-title" className="text-lg font-semibold text-[#f0f6fc]">
              Load Architecture
            </h2>
            <p className="text-sm text-[#8b949e]">Select a saved architecture to open</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto p-3">
          {architectures.length === 0 ? (
            <div className="py-12 text-center">
              <FolderOpen className="mx-auto h-10 w-10 text-[#484f58]" />
              <p className="mt-3 text-sm text-[#8b949e]">No saved architectures yet</p>
              <p className="mt-1 text-xs text-[#484f58]">
                Design your architecture and click Save to store it locally
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {architectures.map((arch) => (
                <li
                  key={arch.id}
                  className="flex items-center gap-3 rounded-lg border border-[#21262d] bg-[#0d1117] p-3 transition-colors hover:border-[#30363d]"
                >
                  <button
                    type="button"
                    onClick={() => onLoad(arch.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate font-medium text-[#f0f6fc]">{arch.name}</p>
                    <p className="mt-0.5 text-xs text-[#8b949e]">
                      {arch.nodeCount} components · {arch.edgeCount} connections · Updated{" "}
                      {formatDate(arch.updatedAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(arch.id, arch.name)}
                    className="rounded-lg p-2 text-[#f85149] hover:bg-[#f8514911]"
                    aria-label={`Delete ${arch.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#21262d] px-5 py-4">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#21262d] px-4 py-2 text-sm font-medium text-[#f0f6fc] hover:bg-[#30363d]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
