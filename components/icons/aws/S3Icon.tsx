import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style S3 icon — layered bucket on green resource tile */
export function S3Icon({ size = 48, className, variant = "resource" }: AwsIconProps) {
  if (variant === "glyph") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={cn("shrink-0", className)}
        aria-hidden
      >
        <path
          d="M4 10c0-1.1 3.6-2 8-2s8 .9 8 2v8c0 1.1-3.6 2-8 2s-8-.9-8-2v-8z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <ellipse cx="12" cy="10" rx="8" ry="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 14h8M8 17h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="48" height="48" rx="8" fill="#569A31" />
      <path
        d="M24 10c-7.7 0-14 2.2-14 5v16c0 2.8 6.3 5 14 5s14-2.2 14-5V15c0-2.8-6.3-5-14-5z"
        fill="#FFF"
        fillOpacity="0.95"
      />
      <ellipse cx="24" cy="15" rx="14" ry="4" fill="#569A31" fillOpacity="0.35" />
      <ellipse cx="24" cy="15" rx="14" ry="4" stroke="#569A31" strokeWidth="1.5" />
      <path d="M16 22h16M16 26h12M16 30h14" stroke="#569A31" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
