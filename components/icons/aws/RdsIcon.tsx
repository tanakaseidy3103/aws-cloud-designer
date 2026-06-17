import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style RDS icon — database cylinder on blue resource tile */
export function RdsIcon({ size = 48, className, variant = "resource" }: AwsIconProps) {
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
        <ellipse cx="12" cy="7" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 7v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V7"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="currentColor" strokeWidth="1.5" />
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
      <rect width="48" height="48" rx="8" fill="#3B48CC" />
      <ellipse cx="24" cy="16" rx="13" ry="4.5" fill="#FFF" fillOpacity="0.95" />
      <path
        d="M11 16v16c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5V16"
        fill="#FFF"
        fillOpacity="0.95"
      />
      <ellipse cx="24" cy="16" rx="13" ry="4.5" stroke="#3B48CC" strokeWidth="1.5" />
      <path d="M11 24c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5" stroke="#3B48CC" strokeWidth="1.5" />
      <path d="M11 28c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5" stroke="#3B48CC" strokeWidth="1.5" />
    </svg>
  );
}
