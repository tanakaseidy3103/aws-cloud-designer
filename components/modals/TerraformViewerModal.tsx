"use client";

import { useState } from "react";
import { X, Copy, Check, Download, FileCode } from "lucide-react";
import type { TerraformOutput } from "@/types";

interface TerraformViewerModalProps {
  open: boolean;
  onClose: () => void;
  terraform: TerraformOutput | null;
  architectureName: string;
}

export function TerraformViewerModal({
  open,
  onClose,
  terraform,
  architectureName,
}: TerraformViewerModalProps) {
  const [selectedFile, setSelectedFile] = useState<string>("main.tf");
  const [copied, setCopied] = useState(false);

  if (!open || !terraform) return null;

  const fileNames = Object.keys(terraform.files);
  const activeContent = terraform.files[selectedFile] || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleDownloadFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    Object.entries(terraform.files).forEach(([name, content]) => {
      handleDownloadFile(name, content);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Dialog container */}
      <div
        role="dialog"
        aria-modal
        aria-labelledby="tf-modal-title"
        className="relative z-10 flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-[#30363d] bg-[#0d1117] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#21262d] bg-[#161b22] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[#8C4FFF]/20">
              <FileCode className="h-4 w-4 text-[#8C4FFF]" />
            </div>
            <div>
              <h2 id="tf-modal-title" className="text-base font-semibold text-[#f0f6fc]">
                Generated Terraform Configuration
              </h2>
              <p className="text-xs text-[#8b949e]">
                HCL code based on &quot;{architectureName}&quot; components
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc] transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* File sidebar tabs */}
          <div className="w-full border-b border-[#21262d] bg-[#161b22]/50 p-2 md:w-52 md:border-b-0 md:border-r">
            <p className="hidden px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#484f58] md:block">
              Terraform Files
            </p>
            <nav className="flex flex-row gap-1 md:mt-1 md:flex-col">
              {fileNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setSelectedFile(name);
                    setCopied(false);
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors md:justify-start ${
                    selectedFile === name
                      ? "bg-[#ff990022] text-[#ff9900]"
                      : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
                  }`}
                >
                  <FileCode className="h-3.5 w-3.5" />
                  <span>{name}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Code Viewer Panel */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-[#0d1117]">
            {/* Action buttons inside viewer */}
            <div className="flex items-center justify-between border-b border-[#21262d] bg-[#161b22]/20 px-4 py-2">
              <span className="font-mono text-xs text-[#8b949e]">{selectedFile}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded bg-[#21262d] px-2.5 py-1.5 text-xs font-medium text-[#c9d1d9] transition-colors hover:bg-[#30363d] hover:text-[#f0f6fc]"
                  title="Copy code to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#3fb950]" />
                      <span className="text-[#3fb950]">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadFile(selectedFile, activeContent)}
                  className="flex items-center gap-1.5 rounded bg-[#21262d] px-2.5 py-1.5 text-xs font-medium text-[#c9d1d9] transition-colors hover:bg-[#30363d] hover:text-[#f0f6fc]"
                  title="Download this file"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            {/* Code Pre container */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-[#e6edf3]">
              <pre className="whitespace-pre-wrap select-text">{activeContent}</pre>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-[#21262d] bg-[#161b22] px-5 py-4">
          <p className="hidden text-xs text-[#8b949e] sm:block">
            Tip: Run <code className="rounded bg-[#21262d] px-1 py-0.5 text-[#ff9900]">terraform init</code> in directory containing these files.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadAll}
              className="flex items-center gap-2 rounded-lg bg-[#21262d] px-4 py-2 text-sm font-medium text-[#f0f6fc] transition-colors hover:bg-[#30363d]"
            >
              <Download className="h-4 w-4" />
              Download All Files
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#c9d1d9] transition-colors hover:bg-[#21262d]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
