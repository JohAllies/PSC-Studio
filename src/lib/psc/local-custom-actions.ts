import type { LoadedFile } from "../file-system";
import { parseDocument, type EditorCustomActionEntity, type EditorNodeEntity } from "./parse";
import type { PscCustomAction, PscDocument } from "../../types/psc";

export type LocalCustomActionSource = {
  customActionId: string;
  fileName: string;
  relativePath: string;
  fileHandle: FileSystemFileHandle | null;
  fileFormat: "standalone" | "document-custom-actions";
};

export type LocalCustomActionRegistry = {
  customActions: Record<string, EditorCustomActionEntity>;
  nodeIndex: Record<string, EditorNodeEntity>;
  sources: Record<string, LocalCustomActionSource>;
  loadedFileCount: number;
  loadedActionCount: number;
  duplicateIds: string[];
  skippedFiles: string[];
};

export type EffectiveCustomActionSource = {
  customActionId: string;
  source: "embedded" | "local";
  overridesEmbedded: boolean;
  fileName: string | null;
  relativePath: string | null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCustomActionShape = (value: unknown): value is PscCustomAction =>
  isPlainRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  Array.isArray(value.actions);

const normalizeCustomAction = (
  customActionId: string,
  value: PscCustomAction,
): PscCustomAction => ({
  ...value,
  id: typeof value.id === "string" && value.id.length > 0 ? value.id : customActionId,
});

const extractCustomActionsFromObject = (
  value: unknown,
): {
  customActions: Record<string, PscCustomAction>;
  fileFormat: "standalone" | "document-custom-actions" | null;
} => {
  if (!isPlainRecord(value)) {
    return {
      customActions: {},
      fileFormat: null,
    };
  }

  const customActionsField = value.customActions;
  if (isPlainRecord(customActionsField)) {
    const extracted: Record<string, PscCustomAction> = {};

    Object.entries(customActionsField).forEach(([customActionId, entry]) => {
      if (!isCustomActionShape(entry)) {
        return;
      }

      extracted[customActionId] = normalizeCustomAction(customActionId, entry);
    });

    return {
      customActions: extracted,
      fileFormat: Object.keys(extracted).length > 0 ? "document-custom-actions" : null,
    };
  }

  if (isCustomActionShape(value)) {
    return {
      customActions: {
        [value.id]: normalizeCustomAction(value.id, value),
      },
      fileFormat: "standalone",
    };
  }

  return {
    customActions: {},
    fileFormat: null,
  };
};

const sortedFiles = (files: LoadedFile[]) =>
  [...files].sort((left, right) =>
    String(left.relativePath ?? left.fileName).localeCompare(
      String(right.relativePath ?? right.fileName),
    ),
  );

export const loadLocalCustomActionsFromFiles = (
  files: LoadedFile[],
): LocalCustomActionRegistry => {
  const mergedCustomActions: Record<string, PscCustomAction> = {};
  const sources: Record<string, LocalCustomActionSource> = {};
  const duplicateIds = new Set<string>();
  const skippedFiles: string[] = [];
  let loadedActionCount = 0;

  sortedFiles(files).forEach((file) => {
    try {
      const parsed = JSON.parse(file.text) as unknown;
      const { customActions, fileFormat } = extractCustomActionsFromObject(parsed);

      if (!fileFormat || Object.keys(customActions).length === 0) {
        skippedFiles.push(file.relativePath ?? file.fileName);
        return;
      }

      Object.entries(customActions).forEach(([customActionId, customAction]) => {
        if (mergedCustomActions[customActionId]) {
          duplicateIds.add(customActionId);
        }

        mergedCustomActions[customActionId] = customAction;
        sources[customActionId] = {
          customActionId,
          fileName: file.fileName,
          relativePath: file.relativePath ?? file.fileName,
          fileHandle: file.handle,
          fileFormat,
        };
        loadedActionCount += 1;
      });
    } catch {
      skippedFiles.push(file.relativePath ?? file.fileName);
    }
  });

  if (Object.keys(mergedCustomActions).length === 0) {
    return {
      customActions: {},
      nodeIndex: {},
      sources: {},
      loadedFileCount: files.length,
      loadedActionCount,
      duplicateIds: [...duplicateIds].sort(),
      skippedFiles,
    };
  }

  const parsed = parseDocument({
    actions: [],
    customActions: mergedCustomActions,
  } satisfies PscDocument);

  return {
    customActions: parsed.customActions,
    nodeIndex: parsed.nodeIndex,
    sources,
    loadedFileCount: files.length,
    loadedActionCount,
    duplicateIds: [...duplicateIds].sort(),
    skippedFiles,
  };
};

export const buildEffectiveCustomActionSources = (
  embeddedCustomActions: Record<string, EditorCustomActionEntity>,
  localCustomActions: Record<string, EditorCustomActionEntity>,
  localSources: Record<string, LocalCustomActionSource>,
): Record<string, EffectiveCustomActionSource> => {
  const effectiveSources: Record<string, EffectiveCustomActionSource> = {};

  Object.keys(embeddedCustomActions).forEach((customActionId) => {
    effectiveSources[customActionId] = {
      customActionId,
      source: "embedded",
      overridesEmbedded: false,
      fileName: null,
      relativePath: null,
    };
  });

  Object.keys(localCustomActions).forEach((customActionId) => {
    const source = localSources[customActionId];
    effectiveSources[customActionId] = {
      customActionId,
      source: "local",
      overridesEmbedded: Boolean(embeddedCustomActions[customActionId]),
      fileName: source?.fileName ?? null,
      relativePath: source?.relativePath ?? null,
    };
  });

  return effectiveSources;
};
