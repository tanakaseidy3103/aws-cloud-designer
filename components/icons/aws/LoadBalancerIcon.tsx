import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style ELB icon — traffic distribution on purple resource tile */
export function LoadBalancerIcon({ size = 48, className, variant = "resource" }: AwsIconProps) {
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
        <circle cx="12" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8.5v3M10.5 12L7 16M13.5 12l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <rect width="48" height="48" rx="8" fill="#8C4FFF" />
      <circle cx="24" cy="14" r="5" fill="#FFF" fillOpacity="0.95" stroke="#8C4FFF" strokeWidth="1.5" />
      <circle cx="13" cy="34" r="4.5" fill="#FFF" fillOpacity="0.95" stroke="#8C4FFF" strokeWidth="1.5" />
      <circle cx="35" cy="34" r="4.5" fill="#FFF" fillOpacity="0.95" stroke="#8C4FFF" strokeWidth="1.5" />
      <path
        d="M24 19v6M20 23l-5 7M28 23l5 7"
        stroke="#FFF"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
