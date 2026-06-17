import type { AwsComponentType } from "@/types";

export interface ServiceTheme {
  accent: string;
  accentMuted: string;
  gradientFrom: string;
  gradientTo: string;
  badge: string;
  glow: string;
}

export const SERVICE_THEMES: Record<AwsComponentType, ServiceTheme> = {
  ec2: {
    accent: "#FF9900",
    accentMuted: "#FF990033",
    gradientFrom: "#FF990018",
    gradientTo: "#161b22",
    badge: "Compute",
    glow: "rgba(255, 153, 0, 0.2)",
  },
  s3: {
    accent: "#569A31",
    accentMuted: "#569A3133",
    gradientFrom: "#569A3118",
    gradientTo: "#161b22",
    badge: "Storage",
    glow: "rgba(86, 154, 49, 0.2)",
  },
  rds: {
    accent: "#3B48CC",
    accentMuted: "#3B48CC33",
    gradientFrom: "#3B48CC18",
    gradientTo: "#161b22",
    badge: "Database",
    glow: "rgba(59, 72, 204, 0.2)",
  },
  lambda: {
    accent: "#FF9900",
    accentMuted: "#FF990033",
    gradientFrom: "#FF990018",
    gradientTo: "#161b22",
    badge: "Serverless",
    glow: "rgba(255, 153, 0, 0.2)",
  },
  "load-balancer": {
    accent: "#8C4FFF",
    accentMuted: "#8C4FFF33",
    gradientFrom: "#8C4FFF18",
    gradientTo: "#161b22",
    badge: "Networking",
    glow: "rgba(140, 79, 255, 0.2)",
  },
  cloudfront: {
    accent: "#8C4FFF",
    accentMuted: "#8C4FFF33",
    gradientFrom: "#8C4FFF18",
    gradientTo: "#161b22",
    badge: "CDN",
    glow: "rgba(140, 79, 255, 0.2)",
  },
};

export function getServiceTheme(type: AwsComponentType): ServiceTheme {
  return SERVICE_THEMES[type];
}
