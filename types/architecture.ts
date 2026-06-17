import type { Edge, Node } from "@xyflow/react";
import type { AwsNodeData } from "./aws";

export interface SavedArchitecture {
  id: string;
  name: string;
  description?: string;
  nodes: Node<AwsNodeData>[];
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ArchitectureMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface ArchitectureState {
  nodes: Node<AwsNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
}

export interface ExportOptions {
  filename?: string;
  backgroundColor?: string;
  quality?: number;
}

/** Future-ready: S3 sync payload shape */
export interface S3SyncPayload {
  architecture: SavedArchitecture;
  checksum: string;
  uploadedAt: string;
}

/** Future-ready: cost estimation input */
export interface CostEstimationInput {
  architectureId: string;
  nodes: Node<AwsNodeData>[];
  region: string;
}

/** Future-ready: collaboration session */
export interface CollaborationSession {
  sessionId: string;
  architectureId: string;
  participants: string[];
  lastSyncedAt: string;
}

/** Future-ready: Terraform generation output */
export interface TerraformOutput {
  architectureId: string;
  provider: "aws";
  files: Record<string, string>;
  generatedAt: string;
}
