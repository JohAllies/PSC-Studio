import type { PscCustomAction, PscDocument, PscNode } from "../../types/psc";

export type EditorSelection =
  | { kind: "document" }
  | { kind: "node"; editorId: string }
  | { kind: "customAction"; customActionId: string }
  | { kind: "image"; imageKey: string };

export type EditorNodeEntity = {
  editorId: string;
  parentEditorId: string | null;
  ownerCustomActionId: string | null;
  raw: Omit<PscNode, "children">;
  childIds: string[];
};

export type EditorCustomActionEntity = {
  customActionId: string;
  raw: Omit<PscCustomAction, "actions">;
  rootNodeIds: string[];
};

export type ParsedDocument = {
  nodeIndex: Record<string, EditorNodeEntity>;
  rootActionIds: string[];
  customActions: Record<string, EditorCustomActionEntity>;
  images: Record<string, string>;
  topLevelFields: Record<string, unknown>;
  topLevelOrder: string[];
};

const createEditorIdFactory = () => {
  let index = 0;

  return () => `editor_${index++}`;
};

const normalizeNode = (
  node: PscNode,
  addEditorId: () => string,
  nodeIndex: Record<string, EditorNodeEntity>,
  parentEditorId: string | null,
  ownerCustomActionId: string | null,
): string => {
  const editorId = addEditorId();
  const { children, ...raw } = node;
  const childIds = (children ?? []).map((child) =>
    normalizeNode(child, addEditorId, nodeIndex, editorId, ownerCustomActionId),
  );

  nodeIndex[editorId] = {
    editorId,
    parentEditorId,
    ownerCustomActionId,
    raw,
    childIds,
  };

  return editorId;
};

export const parseDocument = (document: PscDocument): ParsedDocument => {
  const addEditorId = createEditorIdFactory();
  const nodeIndex: Record<string, EditorNodeEntity> = {};
  const customActions: Record<string, EditorCustomActionEntity> = {};
  const images = { ...(document.images ?? {}) };
  const topLevelFields: Record<string, unknown> = {};
  const topLevelOrder = Object.keys(document);

  Object.entries(document).forEach(([key, value]) => {
    if (key !== "actions" && key !== "customActions" && key !== "images") {
      topLevelFields[key] = value;
    }
  });

  const rootActionIds = (document.actions ?? []).map((node) =>
    normalizeNode(node, addEditorId, nodeIndex, null, null),
  );

  Object.entries(document.customActions ?? {}).forEach(([customActionId, action]) => {
    const { actions, ...raw } = action;
    const rootNodeIds = (actions ?? []).map((node) =>
      normalizeNode(node, addEditorId, nodeIndex, null, customActionId),
    );

    customActions[customActionId] = {
      customActionId,
      raw,
      rootNodeIds,
    };
  });

  return {
    nodeIndex,
    rootActionIds,
    customActions,
    images,
    topLevelFields,
    topLevelOrder,
  };
};

const denormalizeNode = (
  editorId: string,
  nodeIndex: Record<string, EditorNodeEntity>,
): PscNode => {
  const entity = nodeIndex[editorId];
  const node = { ...entity.raw } as PscNode;

  if (entity.childIds.length > 0) {
    node.children = entity.childIds.map((childId) =>
      denormalizeNode(childId, nodeIndex),
    );
  } else if ("children" in node) {
    delete node.children;
  }

  return node;
};

export const serializeParsedDocument = (parsed: ParsedDocument): PscDocument => {
  const output: Record<string, unknown> = {};
  const actionsValue = parsed.rootActionIds.map((editorId) =>
    denormalizeNode(editorId, parsed.nodeIndex),
  );
  const customActionsValue = Object.keys(parsed.customActions).length > 0
    ? Object.fromEntries(
        Object.entries(parsed.customActions).map(([customActionId, entity]) => [
          customActionId,
          {
            ...entity.raw,
            actions: entity.rootNodeIds.map((editorId) =>
              denormalizeNode(editorId, parsed.nodeIndex),
            ),
          },
        ]),
      )
    : undefined;
  const imagesValue =
    Object.keys(parsed.images).length > 0 ? { ...parsed.images } : undefined;

  const fieldMap: Record<string, unknown> = {
    ...parsed.topLevelFields,
    actions: actionsValue,
  };

  if (customActionsValue) {
    fieldMap.customActions = customActionsValue;
  }

  if (imagesValue) {
    fieldMap.images = imagesValue;
  }

  parsed.topLevelOrder.forEach((key) => {
    if (key in fieldMap) {
      output[key] = fieldMap[key];
    }
  });

  Object.entries(fieldMap).forEach(([key, value]) => {
    if (!(key in output)) {
      output[key] = value;
    }
  });

  return output as PscDocument;
};

export const serializeCustomActionEntity = (
  entity: EditorCustomActionEntity,
  nodeIndex: Record<string, EditorNodeEntity>,
): PscCustomAction =>
  ({
    ...entity.raw,
    actions: entity.rootNodeIds.map((editorId) => denormalizeNode(editorId, nodeIndex)),
  }) as PscCustomAction;

export const parseDocumentText = (source: string): PscDocument => {
  const parsed = JSON.parse(source) as PscDocument;

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.actions)) {
    throw new Error("The selected file is not a PSC JSON document with an actions array.");
  }

  return parsed;
};

export const serializeDocumentText = (document: PscDocument): string =>
  JSON.stringify(document, null, 2);
