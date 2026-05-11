import type { EditorCustomActionEntity, EditorNodeEntity } from "./parse";

const plainText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const objectSummary = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return (
    plainText(record.value) ??
    plainText(record.operator) ??
    plainText(record.type) ??
    null
  );
};

const summarizeValue = (value: unknown): string | null => {
  return plainText(value) ?? objectSummary(value);
};

const humanizeId = (id: string) =>
  id
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");

export const formatTreeNodeLabel = (
  node: EditorNodeEntity,
  customActions: Record<string, EditorCustomActionEntity>,
): string => {
  const id = String(node.raw.id ?? "");
  const properties =
    node.raw.properties && typeof node.raw.properties === "object" && !Array.isArray(node.raw.properties)
      ? (node.raw.properties as Record<string, unknown>)
      : {};

  if (id === "COMMENT") {
    return plainText(properties.Comment) ?? "// Comment";
  }

  if (id === "SET_VARIABLE") {
    const variable = plainText(properties["Variable name"]) ?? "variable";
    const value = summarizeValue(properties.Value) ?? "value";
    return `Set variable '${variable}' to '${value}'`;
  }

  if (id === "IF_VARIABLE_IS") {
    const variable = plainText(properties["Variable name"]) ?? "variable";
    const filter = summarizeValue(properties["Filter Value By"]);
    return filter
      ? `If variable '${variable}' is ${filter.toLowerCase()}`
      : `If variable '${variable}' matches condition`;
  }

  if (id === "ELSE_BRANCH") {
    return "else";
  }

  if (id === "OR_BRANCH") {
    return "or";
  }

  if (id === "AND_BRANCH") {
    return "and";
  }

  if (id.startsWith("CUSTOM_")) {
    const customActionId = id.slice("CUSTOM_".length);
    const customAction = customActions[customActionId];
    if (customAction) {
      return customAction.raw.name
        ? String(customAction.raw.name)
        : `Custom Action ${customActionId}`;
    }
  }

  const primaryKeys = [
    "Comment",
    "Variable name",
    "Text",
    "Message",
    "Thread name",
    "Action",
    "File",
    "Map name",
    "List name",
  ];

  for (const key of primaryKeys) {
    const summary = summarizeValue(properties[key]);
    if (summary) {
      return `${humanizeId(id)} '${summary}'`;
    }
  }

  return humanizeId(id);
};

export const nodeCommentColor = (node: EditorNodeEntity): string | null => {
  if (typeof node.raw.color !== "number") {
    return null;
  }

  const rgb = (node.raw.color >>> 0) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
};
