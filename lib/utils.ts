import { v4 as uuidv4 } from "uuid";
import type { AwsComponentType, AwsNodeData } from "@/types";
import { getComponentDefinition, getNodeTypeForComponent } from "./aws-components";
import { DEFAULT_REGION } from "./constants";

export function createNodeFromComponent(
  type: AwsComponentType,
  position: { x: number; y: number }
) {
  const definition = getComponentDefinition(type);
  if (!definition) {
    throw new Error(`Unknown component type: ${type}`);
  }

  const data: AwsNodeData = {
    componentType: type,
    label: definition.defaultLabel,
    description: definition.description,
    region: DEFAULT_REGION,
  };

  return {
    id: uuidv4(),
    type: getNodeTypeForComponent(type),
    position,
    data,
  };
}

export function isAwsComponentType(value: string): value is AwsComponentType {
  return getComponentDefinition(value) !== undefined;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
