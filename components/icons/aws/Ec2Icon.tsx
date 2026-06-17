import { cn } from "@/lib/utils";
import type { AwsIconProps } from "./types";

/** AWS-style EC2 compute icon — server chip on orange resource tile */
export function Ec2Icon({ size = 48, className, variant = "resource" }: AwsIconProps) {
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
        <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 9h16M8 5V4M16 5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="16" cy="12" r="1" fill="currentColor" />
        <path d="M8 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <rect x="10" y="12" width="28" height="24" rx="3" fill="#FFF" fillOpacity="0.95" />
      <rect x="10" y="12" width="28" height="6" rx="3" fill="#232F3E" fillOpacity="0.12" />
      <circle cx="15" cy="24" r="2" fill="#FF9900" />
      <circle cx="24" cy="24" r="2" fill="#FF9900" />
      <circle cx="33" cy="24" r="2" fill="#FF9900" />
      <rect x="15" y="29" width="18" height="2.5" rx="1.25" fill="#FF9900" fillOpacity="0.6" />
      <path d="M14 8h4M30 8h4" stroke="#FFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
