import type { PscDocument, PscNode } from "../../types/psc";
import { parseDocumentText } from "./parse";

export type PscFunctionMenuSeparator = {
  kind: "separator";
  key: string;
};

export type PscFunctionMenuItem = {
  kind: "item";
  key: string;
  label: string;
  node: PscNode;
};

export type PscFunctionMenuGroup = {
  kind: "group";
  key: string;
  label: string;
  entries: PscFunctionMenuEntry[];
};

export type PscFunctionMenuEntry =
  | PscFunctionMenuSeparator
  | PscFunctionMenuItem
  | PscFunctionMenuGroup;

export type PscFunctionMenuSection = {
  key: string;
  label: string;
  entries: PscFunctionMenuEntry[];
};

export type PscFunctionCatalog = {
  available: boolean;
  sections: PscFunctionMenuSection[];
};

const emptyCatalog: PscFunctionCatalog = {
  available: false,
  sections: [],
};

const plainText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const isCommentNode = (node: PscNode): boolean => String(node.id ?? "") === "COMMENT";

const getCommentLabel = (node: PscNode): string | null => {
  if (!isCommentNode(node)) {
    return null;
  }

  const properties =
    node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
      ? (node.properties as Record<string, unknown>)
      : null;

  return properties ? plainText(properties.Comment) : null;
};

const humanizeId = (id: string): string =>
  id
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatActionLabel = (node: PscNode): string => {
  const label = plainText(node.id);
  return label ? humanizeId(label) : "Unnamed Action";
};

const buildMenuEntries = (
  nodes: PscNode[],
  path: string[],
): PscFunctionMenuEntry[] => {
  return nodes.flatMap((node, index) => {
    if (isCommentNode(node)) {
      const label = getCommentLabel(node);
      const children = Array.isArray(node.children) ? node.children : [];

      if (children.length === 0) {
        return label
          ? []
          : [
              {
                kind: "separator",
                key: [...path, `separator-${index}`].join("/"),
              } satisfies PscFunctionMenuSeparator,
            ];
      }

      if (!label) {
        return buildMenuEntries(children, [...path, `group-${index}`]);
      }

      return [
        {
          kind: "group",
          key: [...path, label, String(index)].join("/"),
          label,
          entries: buildMenuEntries(children, [...path, label]),
        } satisfies PscFunctionMenuGroup,
      ];
    }

    return [
      {
        kind: "item",
        key: [...path, String(node.id ?? "action"), String(index)].join("/"),
        label: formatActionLabel(node),
        node: node as PscNode,
      } satisfies PscFunctionMenuItem,
    ];
  });
};

export const buildFunctionCatalog = (document: PscDocument): PscFunctionCatalog => {
  const topLevelNodes = Array.isArray(document.actions) ? document.actions : [];
  const sections: PscFunctionMenuSection[] = [];
  const looseEntries: PscFunctionMenuEntry[] = [];

  topLevelNodes.forEach((node, index) => {
    if (isCommentNode(node)) {
      const label = getCommentLabel(node);
      const children = Array.isArray(node.children) ? node.children : [];

      if (label) {
        sections.push({
          key: `section/${label}/${index}`,
          label,
          entries: buildMenuEntries(children, [label]),
        });
        return;
      }

      looseEntries.push(...buildMenuEntries(children, [`section-${index}`]));
      return;
    }

    looseEntries.push({
      kind: "item",
      key: `loose/${String(node.id ?? "action")}/${index}`,
      label: formatActionLabel(node),
      node,
    });
  });

  if (looseEntries.length > 0) {
    sections.push({
      key: "section/More",
      label: "More",
      entries: looseEntries,
    });
  }

  return {
    available: sections.length > 0,
    sections,
  };
};

export const loadFunctionCatalog = async (): Promise<PscFunctionCatalog> => {
  try {
    const response = await fetch(`/catalog/PSCFunctions.json?v=${Date.now()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return emptyCatalog;
    }

    const source = await response.text();
    const document = parseDocumentText(source);
    return buildFunctionCatalog(document);
  } catch {
    return emptyCatalog;
  }
};
