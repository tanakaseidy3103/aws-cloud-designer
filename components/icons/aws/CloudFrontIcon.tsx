import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style CloudFront icon — globe with CDN brackets on purple tile */
export function CloudFrontIcon({ size = 48, className, variant = "resource" }: AwsIconProps) {
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
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 12h14M12 5a10 10 0 0 1 0 14M12 5a10 10 0 0 0 0 14" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <path
        d="M10 10h5v3h-2v22h-3V10zM33 10h5v28h-3V13h-2v-3z"
        fill="#FFF"
        fillOpacity="0.85"
      />
      <circle cx="24" cy="24" r="10" fill="#FFF" fillOpacity="0.95" />
      <ellipse cx="24" cy="24" rx="10" ry="4" stroke="#8C4FFF" strokeWidth="1.5" />
      <path d="M14 24h20" stroke="#8C4FFF" strokeWidth="1.5" />
      <path
        d="M24 14c3.5 0 6.5 2.2 7.5 5.5M24 34c-3.5 0-6.5-2.2-7.5-5.5"
        stroke="#8C4FFF"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
