import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style Lambda icon — λ symbol on orange resource tile */
export function LambdaIcon({ size = 48, className, variant = "resource" }: AwsIconProps) {
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
          d="M9 6l6 12h-4l2-4H7l2-8h4z"
          fill="currentColor"
        />
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
      <rect width="48" height="48" rx="8" fill="#FF9900" />
      <circle cx="24" cy="24" r="14" fill="#FFF" fillOpacity="0.95" />
      <path
        d="M18 14l10 20h-6.5l3.5-7H16l2-13h6z"
        fill="#FF9900"
      />
    </svg>
  );
}
