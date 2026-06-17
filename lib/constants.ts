export const APP_NAME = "Cloud Architecture Designer";
export const APP_DESCRIPTION =
  "Design, visualize, and export AWS cloud architectures with drag-and-drop simplicity.";

export const STORAGE_KEY = "cloud-architecture-designer";
export const ARCHITECTURES_INDEX_KEY = "cloud-architectures-index";

export const CANVAS_DEFAULTS = {
  minZoom: 0.2,
  maxZoom: 2,
  defaultZoom: 1,
  snapGrid: [16, 16] as [number, number],
  backgroundGap: 20,
  backgroundSize: 1,
} as const;

export const DRAG_DATA_TYPE = "application/cloud-architecture-component";

export const DEFAULT_REGION = "us-east-1";

export const FUTURE_FEATURES = {
  s3Integration: false,
  costEstimation: false,
  teamCollaboration: false,
  terraformGeneration: false,
} as const;
