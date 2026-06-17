import type { Edge, Node } from "@xyflow/react";
import { v4 as uuidv4 } from "uuid";
import type { AwsNodeData } from "@/types";
import { ARCHITECTURES_INDEX_KEY, STORAGE_KEY } from "./constants";
import type { ArchitectureMetadata, SavedArchitecture } from "@/types";

function getStorageKey(id: string): string {
  return `${STORAGE_KEY}:${id}`;
}

function readIndex(): ArchitectureMetadata[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ARCHITECTURES_INDEX_KEY);
    return raw ? (JSON.parse(raw) as ArchitectureMetadata[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(index: ArchitectureMetadata[]): void {
  localStorage.setItem(ARCHITECTURES_INDEX_KEY, JSON.stringify(index));
}

export function listArchitectures(): ArchitectureMetadata[] {
  return readIndex().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function loadArchitecture(id: string): SavedArchitecture | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getStorageKey(id));
    return raw ? (JSON.parse(raw) as SavedArchitecture) : null;
  } catch {
    return null;
  }
}

export function saveArchitecture(
  name: string,
  nodes: Node<AwsNodeData>[],
  edges: Edge[],
  options?: { id?: string; description?: string }
): SavedArchitecture {
  const now = new Date().toISOString();
  const existing = options?.id ? loadArchitecture(options.id) : null;

  const architecture: SavedArchitecture = {
    id: options?.id ?? uuidv4(),
    name,
    description: options?.description ?? existing?.description,
    nodes,
    edges,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };

  localStorage.setItem(getStorageKey(architecture.id), JSON.stringify(architecture));

  const index = readIndex().filter((item) => item.id !== architecture.id);
  index.unshift({
    id: architecture.id,
    name: architecture.name,
    description: architecture.description,
    createdAt: architecture.createdAt,
    updatedAt: architecture.updatedAt,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  });
  writeIndex(index);

  return architecture;
}

export function deleteArchitecture(id: string): void {
  localStorage.removeItem(getStorageKey(id));
  writeIndex(readIndex().filter((item) => item.id !== id));
}

export function createEmptyArchitecture(name = "Untitled Architecture"): SavedArchitecture {
  return saveArchitecture(name, [], []);
}

/** Future-ready: placeholder for S3 upload */
export async function uploadToS3(architecture: SavedArchitecture): Promise<void> {
  void architecture;
  throw new Error("S3 integration is not yet enabled.");
}

/** Future-ready: placeholder for S3 download */
export async function downloadFromS3(id: string): Promise<SavedArchitecture> {
  void id;
  throw new Error("S3 integration is not yet enabled.");
}
