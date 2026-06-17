"use client";

import { useState } from "react";
import { X, Copy, Check, ExternalLink, Globe, Linkedin, CheckCircle } from "lucide-react";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  s3Url: string | null;
  architectureName: string;
  previewImage: string | null;
}

export function ShareModal({
  open,
  onClose,
  s3Url,
  architectureName,
  previewImage,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open || !s3Url) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(s3Url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link: ", err);
    }
  };

  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(s3Url)}`;

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
        aria-labelledby="share-modal-title"
        className="relative z-10 w-full max-w-lg rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#21262d] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[#2ea043]/15">
              <CheckCircle className="h-4.5 w-4.5 text-[#2ea043]" />
            </div>
            <div>
              <h2 id="share-modal-title" className="text-base font-semibold text-[#f0f6fc]">
                Shared to AWS S3 Cloud
              </h2>
              <p className="text-xs text-[#8b949e]">Your diagram is live and shareable</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Preview Image */}
          {previewImage && (
            <div className="relative rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden">
              <p className="absolute top-2 left-2 z-10 rounded-full bg-[#161b22]/80 backdrop-blur px-2 py-0.5 text-[9px] font-semibold text-[#8b949e] flex items-center gap-1">
                <Globe className="h-3 w-3 text-[#ff9900]" />
                Public Cloud Asset
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImage}
                alt={architectureName}
                className="w-full h-44 object-contain p-2"
              />
            </div>
          )}

          {/* URL inputs */}
          <div className="space-y-1.5">
            <label htmlFor="s3-share-link" className="block text-xs font-semibold text-[#8b949e]">
              S3 Public Share Link
            </label>
            <div className="flex gap-2">
              <input
                id="s3-share-link"
                type="text"
                readOnly
                value={s3Url}
                className="min-w-0 flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs font-mono text-[#c9d1d9] outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg bg-[#2ea043] hover:bg-[#2c973f] px-3 py-2 text-xs font-semibold text-white transition-colors"
                title="Copy S3 URL"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* LinkedIn ready box */}
          <div className="rounded-lg border border-[#30363d] bg-[#161b22]/60 p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#ff9900] flex items-center gap-1.5">
              <Linkedin className="h-4 w-4" />
              Recruiter & LinkedIn Ready
            </h3>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              Show off your cloud design skills! Copy the link and share this architecture diagram directly on LinkedIn or embed it in your portfolios/CVs.
            </p>
            <div className="flex gap-2 pt-1">
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded bg-[#0a66c2] hover:bg-[#004182] px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                <Linkedin className="h-3.5 w-3.5" />
                Share on LinkedIn
                <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={s3Url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded border border-[#30363d] hover:bg-[#21262d] px-3 py-1.5 text-xs font-semibold text-[#c9d1d9] transition-colors"
              >
                Open Original Asset
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[#21262d] bg-[#161b22] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#21262d] hover:bg-[#30363d] px-4 py-2 text-sm font-semibold text-[#f0f6fc] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
