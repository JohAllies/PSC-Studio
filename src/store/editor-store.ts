import { produce } from "immer";
import { create } from "zustand";
import type { PscDocument, PscNode, PscWarning } from "../types/psc";
import type { CloudSourceMetadata, EditorDocumentOrigin } from "../lib/supabase/types";
import {
  parseDocument,
  type EditorCustomActionEntity,
  type EditorNodeEntity,
  type EditorSelection,
  type ParsedDocument,
  serializeParsedDocument,
} from "../lib/psc/parse";
import { analyzeDocumentWarnings } from "../lib/psc/warnings";

export type DropPosition = "before" | "after" | "inside";
export type TreeTabId = "actions" | "customActions" | `customAction:${string}`;

export type TreeNodeRef = {
  editorId: string;
  depth: number;
  parentEditorId: string | null;
  ownerCustomActionId: string | null;
};

type EditorStoreState = ParsedDocument & {
  documentSourceName: string;
  warnings: PscWarning[];
  selection: EditorSelection;
  activeTabId: TreeTabId;
  openCustomActionTabIds: string[];
  focusedCustomActionId: string | null;
  collapsedNodeIds: Record<string, boolean>;
  fileHandle: FileSystemFileHandle | null;
  documentOrigin: EditorDocumentOrigin;
  cloudSource: CloudSourceMetadata | null;
  savedDocumentText: string;
  isDirty: boolean;
  pendingEditKeys: Record<string, true>;
  pendingEditCount: number;
  invalidEditKeys: Record<string, true>;
  invalidEditCount: number;
  undoStack: PscDocument[];
  externalCustomActionIds: Record<string, true>;
};

type EditorStoreActions = {
  loadDocument: (document: PscDocument, sourceName?: string) => void;
  saveDocument: () => PscDocument;
  saveDocumentText: () => string;
  getWarnings: () => PscWarning[];
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  setDocumentOrigin: (origin: EditorDocumentOrigin) => void;
  setCloudSourceMetadata: (metadata: CloudSourceMetadata) => void;
  clearCloudSourceMetadata: () => void;
  setDocumentSourceName: (sourceName: string) => void;
  markSaved: (documentText: string) => void;
  setPendingEdit: (editKey: string, pending: boolean) => void;
  setInvalidEdit: (editKey: string, invalid: boolean) => void;
  selectDocument: () => void;
  selectNode: (editorId: string) => void;
  selectCustomAction: (customActionId: string) => void;
  selectImage: (imageKey: string) => void;
  setActiveTab: (tabId: TreeTabId) => void;
  openCustomActionTab: (customActionId: string) => void;
  closeCustomActionTab: (customActionId: string) => void;
  toggleNodeCollapsed: (editorId: string) => void;
  removeNode: (editorId: string) => void;
  removeNodes: (editorIds: string[]) => void;
  moveNode: (
    sourceEditorId: string,
    targetEditorId: string,
    position: DropPosition,
  ) => void;
  insertNode: (
    targetParentEditorId: string | null,
    ownerCustomActionId: string | null,
    positionIndex?: number,
  ) => void;
  insertNodeTemplate: (
    nodeTemplate: PscNode,
    targetParentEditorId: string | null,
    ownerCustomActionId: string | null,
    positionIndex?: number,
  ) => void;
  insertNodeTemplates: (
    nodeTemplates: PscNode[],
    targetParentEditorId: string | null,
    ownerCustomActionId: string | null,
    positionIndex?: number,
  ) => void;
  updateNodeProperties: (editorId: string, properties: Record<string, unknown>) => void;
  updateNodeRawField: (editorId: string, field: string, value: unknown) => void;
  toggleNodeDisabled: (editorId: string) => void;
  renameCustomAction: (customActionId: string, nextName: string) => void;
  updateCustomActionField: (
    customActionId: string,
    field: string,
    value: unknown,
  ) => void;
  updateDocumentField: (field: string, value: unknown) => void;
  updateImageAsset: (imageKey: string, value: string) => void;
  setExternalCustomActionIds: (customActionIds: string[]) => void;
  undo: () => void;
};

export type EditorStore = EditorStoreState & EditorStoreActions;

const createBlankDocument = (): PscDocument => ({
  name: "Untitled PSC Script",
  version: "0.1.0",
  sleep: 150,
  actions: [],
  customActions: {},
  images: {},
});

const customActionTabId = (customActionId: string): TreeTabId => `customAction:${customActionId}`;

const getActiveCustomActionId = (activeTabId: TreeTabId): string | null =>
  activeTabId.startsWith("customAction:") ? activeTabId.slice("customAction:".length) : null;

const createBlankNode = (): Omit<EditorNodeEntity, "editorId" | "childIds"> => ({
  parentEditorId: null,
  ownerCustomActionId: null,
  raw: {
    id: "COMMENT",
    properties: {
      Comment: "New PSC node",
    },
  },
});

const cloneJsonValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createEditorId = () =>
  `editor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const collectTree = (
  rootIds: string[],
  nodeIndex: Record<string, EditorNodeEntity>,
  collapsedNodeIds: Record<string, boolean>,
  depth = 0,
): TreeNodeRef[] => {
  return rootIds.flatMap((editorId) => {
    const entity = nodeIndex[editorId];
    const current: TreeNodeRef = {
      editorId,
      depth,
      parentEditorId: entity.parentEditorId,
      ownerCustomActionId: entity.ownerCustomActionId,
    };

    if (collapsedNodeIds[editorId]) {
      return [current];
    }

    return [current, ...collectTree(entity.childIds, nodeIndex, collapsedNodeIds, depth + 1)];
  });
};

const removeFromArray = <T,>(items: T[], value: T): T[] =>
  items.filter((item) => item !== value);

const insertAt = <T,>(items: T[], index: number, value: T): T[] => {
  const next = [...items];
  next.splice(index, 0, value);
  return next;
};

const insertManyAt = <T,>(items: T[], index: number, values: T[]): T[] => {
  const next = [...items];
  next.splice(index, 0, ...values);
  return next;
};

const isAncestor = (
  candidateAncestorId: string,
  currentId: string,
  nodeIndex: Record<string, EditorNodeEntity>,
): boolean => {
  let cursor = nodeIndex[currentId]?.parentEditorId ?? null;

  while (cursor) {
    if (cursor === candidateAncestorId) {
      return true;
    }
    cursor = nodeIndex[cursor]?.parentEditorId ?? null;
  }

  return false;
};

const applyOwnerToSubtree = (
  editorId: string,
  ownerCustomActionId: string | null,
  nodeIndex: Record<string, EditorNodeEntity>,
) => {
  const node = nodeIndex[editorId];
  node.ownerCustomActionId = ownerCustomActionId;
  node.childIds.forEach((childId) =>
    applyOwnerToSubtree(childId, ownerCustomActionId, nodeIndex),
  );
};

const createInitialState = (): EditorStoreState => {
  const parsed = parseDocument(createBlankDocument());
  const serialized = JSON.stringify(serializeParsedDocument(parsed), null, 2);

  return {
    ...parsed,
    documentSourceName: "Untitled PSC Script",
    warnings: analyzeDocumentWarnings(serializeParsedDocument(parsed)),
    selection: { kind: "document" },
    activeTabId: "actions",
    openCustomActionTabIds: [],
    focusedCustomActionId: Object.keys(parsed.customActions)[0] ?? null,
    collapsedNodeIds: {},
    fileHandle: null,
    documentOrigin: "unsaved",
    cloudSource: null,
    savedDocumentText: serialized,
    isDirty: false,
    pendingEditKeys: {},
    pendingEditCount: 0,
    invalidEditKeys: {},
    invalidEditCount: 0,
    undoStack: [],
    externalCustomActionIds: {},
  };
};

const buildAvailableCustomActions = (draft: EditorStoreState) => ({
  ...Object.fromEntries(
    Object.keys(draft.customActions).map((customActionId) => [customActionId, true]),
  ),
  ...draft.externalCustomActionIds,
});

const serializeEffectiveDocument = (draft: EditorStoreState) =>
  serializeParsedDocument(draft);

const refreshWarnings = (draft: EditorStoreState) => {
  const document = serializeEffectiveDocument(draft);
  draft.warnings = analyzeDocumentWarnings(document, buildAvailableCustomActions(draft));
};

const markDirty = (draft: EditorStoreState) => {
  draft.isDirty = true;
};

const pushUndoSnapshot = (draft: EditorStoreState) => {
  draft.undoStack.push(serializeParsedDocument(draft));
  if (draft.undoStack.length > 50) {
    draft.undoStack.shift();
  }
};

const restoreDocumentState = (
  draft: EditorStoreState,
  document: PscDocument,
) => {
  const parsed = parseDocument(document);
  draft.nodeIndex = parsed.nodeIndex;
  draft.rootActionIds = parsed.rootActionIds;
  draft.customActions = parsed.customActions;
  draft.images = parsed.images;
  draft.topLevelFields = parsed.topLevelFields;
  draft.topLevelOrder = parsed.topLevelOrder;
  draft.warnings = analyzeDocumentWarnings(document, {
    ...Object.fromEntries(
      Object.keys(parsed.customActions).map((customActionId) => [customActionId, true]),
    ),
    ...draft.externalCustomActionIds,
  });
  draft.selection = { kind: "document" };
  draft.activeTabId = "actions";
  draft.openCustomActionTabIds = [];
  draft.focusedCustomActionId = Object.keys(parsed.customActions)[0] ?? null;
  draft.collapsedNodeIds = {};
  draft.isDirty = JSON.stringify(document, null, 2) !== draft.savedDocumentText;
  draft.pendingEditKeys = {};
  draft.pendingEditCount = 0;
  draft.invalidEditKeys = {};
  draft.invalidEditCount = 0;
};

const deleteNodeSubtree = (
  editorId: string,
  nodeIndex: Record<string, EditorNodeEntity>,
) => {
  const node = nodeIndex[editorId];
  if (!node) {
    return;
  }

  node.childIds.forEach((childId) => deleteNodeSubtree(childId, nodeIndex));
  delete nodeIndex[editorId];
};

const detachNodeFromParent = (
  draft: EditorStoreState,
  editorId: string,
) => {
  const node = draft.nodeIndex[editorId];
  if (!node) {
    return;
  }

  if (node.parentEditorId) {
    draft.nodeIndex[node.parentEditorId].childIds = removeFromArray(
      draft.nodeIndex[node.parentEditorId].childIds,
      editorId,
    );
  } else if (node.ownerCustomActionId) {
    draft.customActions[node.ownerCustomActionId].rootNodeIds = removeFromArray(
      draft.customActions[node.ownerCustomActionId].rootNodeIds,
      editorId,
    );
  } else {
    draft.rootActionIds = removeFromArray(draft.rootActionIds, editorId);
  }
};

const insertNodeEntity = (
  draft: EditorStoreState,
  nodeTemplate: PscNode,
  parentEditorId: string | null,
  ownerCustomActionId: string | null,
): string => {
  const clonedTemplate = cloneJsonValue(nodeTemplate);
  const { children, ...raw } = clonedTemplate;
  const editorId = createEditorId();

  draft.nodeIndex[editorId] = {
    editorId,
    parentEditorId,
    ownerCustomActionId,
    raw,
    childIds: [],
  };

  draft.nodeIndex[editorId].childIds = (children ?? []).map((childNode) =>
    insertNodeEntity(draft, childNode, editorId, ownerCustomActionId),
  );

  return editorId;
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...createInitialState(),

  loadDocument: (document, sourceName = document.name as string | undefined) =>
    set((state) => {
      const parsed = parseDocument(document);

      return {
        ...parsed,
        documentSourceName: sourceName ?? "Loaded PSC Script",
        warnings: analyzeDocumentWarnings(document, {
          ...Object.fromEntries(
            Object.keys(parsed.customActions).map((customActionId) => [customActionId, true]),
          ),
          ...state.externalCustomActionIds,
        }),
        selection: { kind: "document" },
        activeTabId: "actions",
        openCustomActionTabIds: [],
        focusedCustomActionId: Object.keys(parsed.customActions)[0] ?? null,
        collapsedNodeIds: {},
        fileHandle: null,
        documentOrigin: "unsaved",
        cloudSource: null,
        savedDocumentText: JSON.stringify(document, null, 2),
        isDirty: false,
        pendingEditKeys: {},
        pendingEditCount: 0,
        invalidEditKeys: {},
        invalidEditCount: 0,
        undoStack: [],
        externalCustomActionIds: state.externalCustomActionIds,
      };
    }),

  saveDocument: () => serializeParsedDocument(get()),

  saveDocumentText: () => JSON.stringify(serializeParsedDocument(get()), null, 2),

  getWarnings: () => get().warnings,

  setFileHandle: (handle) =>
    set((state) => ({
      ...state,
      fileHandle: handle,
    })),

  setDocumentOrigin: (documentOrigin) =>
    set((state) => ({
      ...state,
      documentOrigin,
    })),

  setCloudSourceMetadata: (cloudSource) =>
    set((state) => ({
      ...state,
      cloudSource,
      documentOrigin: "cloud",
    })),

  clearCloudSourceMetadata: () =>
    set((state) => ({
      ...state,
      cloudSource: null,
      documentOrigin: state.documentOrigin === "cloud" ? "unsaved" : state.documentOrigin,
    })),

  setDocumentSourceName: (documentSourceName) =>
    set((state) => ({
      ...state,
      documentSourceName,
    })),

  markSaved: (documentText) =>
    set((state) => ({
      ...state,
      savedDocumentText: documentText,
      isDirty: false,
      warnings: analyzeDocumentWarnings(
        serializeParsedDocument(state),
        buildAvailableCustomActions(state),
      ),
    })),

  setPendingEdit: (editKey, pending) =>
    set((state) => {
      const alreadyPending = Boolean(state.pendingEditKeys[editKey]);
      if (alreadyPending === pending) {
        return state;
      }

      const nextPendingEditKeys = { ...state.pendingEditKeys };
      if (pending) {
        nextPendingEditKeys[editKey] = true;
      } else {
        delete nextPendingEditKeys[editKey];
      }

      return {
        ...state,
        pendingEditKeys: nextPendingEditKeys,
        pendingEditCount: Object.keys(nextPendingEditKeys).length,
      };
    }),

  setInvalidEdit: (editKey, invalid) =>
    set((state) => {
      const alreadyInvalid = Boolean(state.invalidEditKeys[editKey]);
      if (alreadyInvalid === invalid) {
        return state;
      }

      const nextInvalidEditKeys = { ...state.invalidEditKeys };
      if (invalid) {
        nextInvalidEditKeys[editKey] = true;
      } else {
        delete nextInvalidEditKeys[editKey];
      }

      return {
        ...state,
        invalidEditKeys: nextInvalidEditKeys,
        invalidEditCount: Object.keys(nextInvalidEditKeys).length,
      };
    }),

  selectDocument: () =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.selection = { kind: "document" };
      }),
    ),

  selectNode: (editorId) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.selection = { kind: "node", editorId };
        const ownerCustomActionId = draft.nodeIndex[editorId]?.ownerCustomActionId ?? null;
        draft.activeTabId = ownerCustomActionId ? customActionTabId(ownerCustomActionId) : "actions";
        if (ownerCustomActionId) {
          draft.focusedCustomActionId = ownerCustomActionId;
          if (!draft.openCustomActionTabIds.includes(ownerCustomActionId)) {
            draft.openCustomActionTabIds.push(ownerCustomActionId);
          }
        }
      }),
    ),

  selectCustomAction: (customActionId) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.selection = { kind: "customAction", customActionId };
        draft.activeTabId = "customActions";
        draft.focusedCustomActionId = customActionId;
      }),
    ),

  selectImage: (imageKey) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.selection = { kind: "image", imageKey };
      }),
    ),

  setActiveTab: (tabId) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.activeTabId = tabId;
        const activeCustomActionId = getActiveCustomActionId(tabId);
        if (tabId === "customActions" && !draft.focusedCustomActionId) {
          draft.focusedCustomActionId = Object.keys(draft.customActions)[0] ?? null;
        }
        if (activeCustomActionId) {
          draft.focusedCustomActionId = activeCustomActionId;
          if (!draft.openCustomActionTabIds.includes(activeCustomActionId)) {
            draft.openCustomActionTabIds.push(activeCustomActionId);
          }
        }
      }),
    ),

  openCustomActionTab: (customActionId) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (!draft.openCustomActionTabIds.includes(customActionId)) {
          draft.openCustomActionTabIds.push(customActionId);
        }

        draft.focusedCustomActionId = customActionId;
        draft.activeTabId = customActionTabId(customActionId);
        draft.selection = { kind: "customAction", customActionId };
      }),
    ),

  closeCustomActionTab: (customActionId) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.openCustomActionTabIds = draft.openCustomActionTabIds.filter(
          (openTabId) => openTabId !== customActionId,
        );

        if (draft.activeTabId === customActionTabId(customActionId)) {
          const nextCustomActionId = draft.openCustomActionTabIds[0] ?? null;

          if (nextCustomActionId) {
            draft.activeTabId = customActionTabId(nextCustomActionId);
            draft.focusedCustomActionId = nextCustomActionId;
            draft.selection = { kind: "customAction", customActionId: nextCustomActionId };
          } else {
            draft.activeTabId = "customActions";
            draft.focusedCustomActionId =
              draft.focusedCustomActionId === customActionId
                ? Object.keys(draft.customActions)[0] ?? null
                : draft.focusedCustomActionId;
          }
        }
      }),
    ),

  toggleNodeCollapsed: (editorId) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.collapsedNodeIds[editorId] = !draft.collapsedNodeIds[editorId];
      }),
    ),

  removeNode: (editorId) =>
    set(
      produce<EditorStoreState>((draft) => {
        const node = draft.nodeIndex[editorId];
        if (!node) {
          return;
        }

        pushUndoSnapshot(draft);
        detachNodeFromParent(draft, editorId);

        deleteNodeSubtree(editorId, draft.nodeIndex);
        delete draft.collapsedNodeIds[editorId];
        draft.selection = { kind: "document" };
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  removeNodes: (editorIds) =>
    set(
      produce<EditorStoreState>((draft) => {
        const existingIds = editorIds.filter((editorId) => Boolean(draft.nodeIndex[editorId]));
        if (existingIds.length === 0) {
          return;
        }

        pushUndoSnapshot(draft);

        existingIds.forEach((editorId) => {
          detachNodeFromParent(draft, editorId);
          deleteNodeSubtree(editorId, draft.nodeIndex);
          delete draft.collapsedNodeIds[editorId];
        });

        draft.selection = { kind: "document" };
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  moveNode: (sourceEditorId, targetEditorId, position) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (
          sourceEditorId === targetEditorId ||
          !draft.nodeIndex[sourceEditorId] ||
          !draft.nodeIndex[targetEditorId] ||
          isAncestor(sourceEditorId, targetEditorId, draft.nodeIndex)
        ) {
          return;
        }

        pushUndoSnapshot(draft);

        const sourceNode = draft.nodeIndex[sourceEditorId];
        const targetNode = draft.nodeIndex[targetEditorId];

        const sourceSiblingIds = sourceNode.parentEditorId
          ? draft.nodeIndex[sourceNode.parentEditorId].childIds
          : sourceNode.ownerCustomActionId
            ? draft.customActions[sourceNode.ownerCustomActionId].rootNodeIds
            : draft.rootActionIds;

        if (sourceNode.parentEditorId) {
          draft.nodeIndex[sourceNode.parentEditorId].childIds = removeFromArray(
            sourceSiblingIds,
            sourceEditorId,
          );
        } else if (sourceNode.ownerCustomActionId) {
          draft.customActions[sourceNode.ownerCustomActionId].rootNodeIds = removeFromArray(
            sourceSiblingIds,
            sourceEditorId,
          );
        } else {
          draft.rootActionIds = removeFromArray(sourceSiblingIds, sourceEditorId);
        }

        if (position === "inside") {
          targetNode.childIds.push(sourceEditorId);
          sourceNode.parentEditorId = targetEditorId;
          applyOwnerToSubtree(
            sourceEditorId,
            targetNode.ownerCustomActionId,
            draft.nodeIndex,
          );
        } else {
          const destinationParentEditorId = targetNode.parentEditorId;
          const destinationOwnerCustomActionId = targetNode.ownerCustomActionId;
          const destinationSiblings = destinationParentEditorId
            ? draft.nodeIndex[destinationParentEditorId].childIds
            : destinationOwnerCustomActionId
              ? draft.customActions[destinationOwnerCustomActionId].rootNodeIds
              : draft.rootActionIds;
          const targetIndex = destinationSiblings.indexOf(targetEditorId);
          const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
          const nextSiblings = insertAt(destinationSiblings, insertIndex, sourceEditorId);

          if (destinationParentEditorId) {
            draft.nodeIndex[destinationParentEditorId].childIds = nextSiblings;
          } else if (destinationOwnerCustomActionId) {
            draft.customActions[destinationOwnerCustomActionId].rootNodeIds = nextSiblings;
          } else {
            draft.rootActionIds = nextSiblings;
          }

          sourceNode.parentEditorId = destinationParentEditorId;
          applyOwnerToSubtree(
            sourceEditorId,
            destinationOwnerCustomActionId,
            draft.nodeIndex,
          );
        }

        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  insertNode: (targetParentEditorId, ownerCustomActionId, positionIndex) =>
    set(
      produce<EditorStoreState>((draft) => {
        pushUndoSnapshot(draft);
        const editorId = createEditorId();
        draft.nodeIndex[editorId] = {
          editorId,
          childIds: [],
          ...createBlankNode(),
          parentEditorId: targetParentEditorId,
          ownerCustomActionId,
        };

        if (targetParentEditorId) {
          const siblings = draft.nodeIndex[targetParentEditorId].childIds;
          const index = positionIndex ?? siblings.length;
          draft.nodeIndex[targetParentEditorId].childIds = insertAt(siblings, index, editorId);
        } else if (ownerCustomActionId) {
          const siblings = draft.customActions[ownerCustomActionId].rootNodeIds;
          const index = positionIndex ?? siblings.length;
          draft.customActions[ownerCustomActionId].rootNodeIds = insertAt(siblings, index, editorId);
        } else {
          const index = positionIndex ?? draft.rootActionIds.length;
          draft.rootActionIds = insertAt(draft.rootActionIds, index, editorId);
        }

        draft.selection = { kind: "node", editorId };
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  insertNodeTemplate: (nodeTemplate, targetParentEditorId, ownerCustomActionId, positionIndex) =>
    set(
      produce<EditorStoreState>((draft) => {
        pushUndoSnapshot(draft);
        const editorId = insertNodeEntity(
          draft,
          nodeTemplate,
          targetParentEditorId,
          ownerCustomActionId,
        );

        if (targetParentEditorId) {
          const siblings = draft.nodeIndex[targetParentEditorId].childIds;
          const index = positionIndex ?? siblings.length;
          draft.nodeIndex[targetParentEditorId].childIds = insertAt(siblings, index, editorId);
        } else if (ownerCustomActionId) {
          const siblings = draft.customActions[ownerCustomActionId].rootNodeIds;
          const index = positionIndex ?? siblings.length;
          draft.customActions[ownerCustomActionId].rootNodeIds = insertAt(siblings, index, editorId);
        } else {
          const index = positionIndex ?? draft.rootActionIds.length;
          draft.rootActionIds = insertAt(draft.rootActionIds, index, editorId);
        }

        draft.selection = { kind: "node", editorId };
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  insertNodeTemplates: (nodeTemplates, targetParentEditorId, ownerCustomActionId, positionIndex) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (nodeTemplates.length === 0) {
          return;
        }

        pushUndoSnapshot(draft);
        const editorIds = nodeTemplates.map((nodeTemplate) =>
          insertNodeEntity(
            draft,
            nodeTemplate,
            targetParentEditorId,
            ownerCustomActionId,
          ),
        );

        if (targetParentEditorId) {
          const siblings = draft.nodeIndex[targetParentEditorId].childIds;
          const index = positionIndex ?? siblings.length;
          draft.nodeIndex[targetParentEditorId].childIds = insertManyAt(siblings, index, editorIds);
        } else if (ownerCustomActionId) {
          const siblings = draft.customActions[ownerCustomActionId].rootNodeIds;
          const index = positionIndex ?? siblings.length;
          draft.customActions[ownerCustomActionId].rootNodeIds = insertManyAt(
            siblings,
            index,
            editorIds,
          );
        } else {
          const index = positionIndex ?? draft.rootActionIds.length;
          draft.rootActionIds = insertManyAt(draft.rootActionIds, index, editorIds);
        }

        draft.selection = { kind: "node", editorId: editorIds[editorIds.length - 1] };
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  updateNodeProperties: (editorId, properties) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (!draft.nodeIndex[editorId]) {
          return;
        }
        pushUndoSnapshot(draft);
        draft.nodeIndex[editorId].raw.properties = properties;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  updateNodeRawField: (editorId, field, value) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (!draft.nodeIndex[editorId]) {
          return;
        }
        pushUndoSnapshot(draft);
        draft.nodeIndex[editorId].raw[field] = value;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  toggleNodeDisabled: (editorId) =>
    set(
      produce<EditorStoreState>((draft) => {
        const node = draft.nodeIndex[editorId];
        if (!node) {
          return;
        }

        pushUndoSnapshot(draft);
        node.raw.disabled = !node.raw.disabled;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  renameCustomAction: (customActionId, nextName) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (!draft.customActions[customActionId]) {
          return;
        }
        pushUndoSnapshot(draft);
        draft.customActions[customActionId].raw.name = nextName;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  updateCustomActionField: (customActionId, field, value) =>
    set(
      produce<EditorStoreState>((draft) => {
        if (!draft.customActions[customActionId]) {
          return;
        }
        pushUndoSnapshot(draft);
        draft.customActions[customActionId].raw[field] = value;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  updateDocumentField: (field, value) =>
    set(
      produce<EditorStoreState>((draft) => {
        pushUndoSnapshot(draft);
        draft.topLevelFields[field] = value;
        if (!draft.topLevelOrder.includes(field)) {
          draft.topLevelOrder.push(field);
        }
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  updateImageAsset: (imageKey, value) =>
    set(
      produce<EditorStoreState>((draft) => {
        pushUndoSnapshot(draft);
        draft.images[imageKey] = value;
        markDirty(draft);
        refreshWarnings(draft);
      }),
    ),

  setExternalCustomActionIds: (customActionIds) =>
    set(
      produce<EditorStoreState>((draft) => {
        draft.externalCustomActionIds = Object.fromEntries(
          customActionIds.map((customActionId) => [customActionId, true]),
        );
        refreshWarnings(draft);
      }),
    ),

  undo: () =>
    set(
      produce<EditorStoreState>((draft) => {
        const previous = draft.undoStack.pop();
        if (!previous) {
          return;
        }

        restoreDocumentState(draft, previous);
      }),
    ),
}));

export const selectVisibleTreeNodes = (store: EditorStoreState): TreeNodeRef[] => {
  if (store.activeTabId === "actions") {
    return collectTree(store.rootActionIds, store.nodeIndex, store.collapsedNodeIds);
  }

  const activeCustomActionId = getActiveCustomActionId(store.activeTabId);

  if (!activeCustomActionId || !store.customActions[activeCustomActionId]) {
    return [];
  }

  return collectTree(
    store.customActions[activeCustomActionId].rootNodeIds,
    store.nodeIndex,
    store.collapsedNodeIds,
  );
};

export const selectCurrentCustomAction = (
  store: EditorStoreState,
): EditorCustomActionEntity | null => {
  const activeCustomActionId = getActiveCustomActionId(store.activeTabId);

  if (!activeCustomActionId) {
    return null;
  }

  return store.customActions[activeCustomActionId] ?? null;
};
