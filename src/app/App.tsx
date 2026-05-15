import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MenuBar } from "../components/MenuBar";
import { ScriptTree } from "../components/ScriptTree";
import { Inspector } from "../components/Inspector";
import { loadFunctionCatalog, type PscFunctionCatalog } from "../lib/psc/catalog";
import { useSupabaseAuth } from "../lib/supabase/auth";
import {
  type JsonDirectoryTreeNode,
  openJsonDirectory,
  openJsonDocuments,
  openJsonDocument,
  readJsonDirectoryTree,
  readJsonDirectory,
  readTextFileHandle,
  saveJsonDocument,
  supportsNativeFileAccess,
  supportsNativeDirectoryAccess,
  writeJsonFileInDirectory,
  writeTextToFileHandle,
} from "../lib/file-system";
import { formatTreeNodeLabel } from "../lib/psc/labels";
import { parseDocumentText, serializeCustomActionEntity } from "../lib/psc/parse";
import {
  buildEffectiveCustomActionSources,
  loadLocalCustomActionsFromFiles,
  type EffectiveCustomActionSource,
  type LocalCustomActionRegistry,
} from "../lib/psc/local-custom-actions";
import {
  clearStoredDirectoryHandle,
  loadStoredDirectoryHandle,
  queryDirectoryPermission,
  requestDirectoryPermission,
  storeDirectoryHandle,
} from "../lib/local-directory-handles";
import {
  CloudScriptConflictError,
  createUserScript,
  deleteUserScript,
  getJsonSizeBytes,
  getUserScript,
  getUserStorageUsage,
  listUserScripts,
  updateUserScript,
} from "../lib/supabase/scripts";
import type { CloudScriptSummary } from "../lib/supabase/types";
import type { PscNode } from "../types/psc";
import { useEditorStore } from "../store/editor-store";

const createInitialDocument = () =>
  ({
    sleep: "0",
    name: "Untitled PSC Script",
    version: 1.0,
    actions: [],
    customActions: {},
    images: {},
  }) satisfies Parameters<ReturnType<typeof useEditorStore.getState>["loadDocument"]>[0];

const sanitizeCustomActionFileName = (value: string, fallbackId: string) => {
  const base = value
    .replace(/>/g, " ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const safeBase = base.length > 0 ? base : fallbackId;
  return `${safeBase}.json`;
};

const findLocalScriptNodeByPath = (
  nodes: JsonDirectoryTreeNode[],
  targetPath: string,
): Extract<JsonDirectoryTreeNode, { kind: "file" }> | null => {
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.path === targetPath) {
        return node;
      }
      continue;
    }

    const match = findLocalScriptNodeByPath(node.children, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
};

const findLocalScriptNodesByName = (
  nodes: JsonDirectoryTreeNode[],
  targetName: string,
): Array<Extract<JsonDirectoryTreeNode, { kind: "file" }>> => {
  const matches: Array<Extract<JsonDirectoryTreeNode, { kind: "file" }>> = [];

  nodes.forEach((node) => {
    if (node.kind === "file") {
      if (node.name === targetName) {
        matches.push(node);
      }
      return;
    }

    matches.push(...findLocalScriptNodesByName(node.children, targetName));
  });

  return matches;
};

type SavePreference = "unset" | "ask" | "overwrite";
type SavePromptMode = "initialPreference" | "saveChoice";
type SavePromptChoice =
  | "overwrite"
  | "overwriteAlways"
  | "askEveryTime"
  | "saveAs"
  | "cancel";
type CustomActionSaveChoice = "localOnly" | "bakedOnly" | "both" | "cancel";
type CustomActionSavePromptMode = "bakedOnlyNoLocal" | "bothSources";
type GateNotice = {
  tone: "success" | "error";
  text: string;
};

type LocalCustomActionLibraryState = LocalCustomActionRegistry & {
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryName: string | null;
  loading: boolean;
  notice: string | null;
  error: string | null;
};

type LocalScriptLibraryState = {
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryName: string | null;
  tree: JsonDirectoryTreeNode[];
  loading: boolean;
  error: string | null;
};

const SAVE_PREFERENCE_KEY = "psc-studio-save-preference";
const WORKSPACE_SPLIT_KEY = "psc-studio-workspace-split";
const CLOUD_STORAGE_QUOTA_LABEL = "25MB";

type StatusScreenProps = {
  eyebrow: string;
  title: string;
  text: string;
  detail?: string | null;
  actionLabel?: string;
  onAction?: () => void;
};

const StatusScreen = ({
  eyebrow,
  title,
  text,
  detail,
  actionLabel,
  onAction,
}: StatusScreenProps) => (
  <div className="status-screen">
    <div className="status-card">
      <div className="status-card__eyebrow">{eyebrow}</div>
      <h1 className="status-card__title">{title}</h1>
      <p className="status-card__text">{text}</p>
      {detail ? <div className="status-card__detail">{detail}</div> : null}
      {actionLabel && onAction ? (
        <div className="status-card__actions">
          <button className="app-button app-button--menu app-button--accent" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  </div>
);

type AuthGateProps = {
  email: string;
  notice: GateNotice | null;
  submitting: boolean;
  onEmailChange: (email: string) => void;
  onSubmit: () => Promise<void>;
};

const AuthGate = ({
  email,
  notice,
  submitting,
  onEmailChange,
  onSubmit,
}: AuthGateProps) => (
  <div className="auth-screen">
    <div className="auth-card">
      <div className="auth-card__eyebrow">PSC Studio</div>
      <h1 className="auth-card__title">Invite-only access</h1>
      <p className="auth-card__text">
        Sign in with the email address that was granted access to PSC Studio.
      </p>
      <p className="auth-card__meta">
        Accounts are provisioned manually. There is no self sign-up.
      </p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="editor-input"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        {notice ? (
          <div
            className={`gate-notice ${
              notice.tone === "success" ? "gate-notice--success" : "gate-notice--error"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        <div className="auth-form__actions">
          <button
            className="app-button app-button--menu app-button--accent"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Sending..." : "Send magic link"}
          </button>
        </div>
      </form>
    </div>
  </div>
);

export const App = () => {
  const auth = useSupabaseAuth();
  const authUserId = auth.user?.id ?? null;
  const [catalog, setCatalog] = useState<PscFunctionCatalog>({
    available: false,
    sections: [],
  });
  const [bootState, setBootState] = useState<"loading" | "ready">("loading");
  const [authEmail, setAuthEmail] = useState("");
  const [authNotice, setAuthNotice] = useState<GateNotice | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [cloudScripts, setCloudScripts] = useState<CloudScriptSummary[]>([]);
  const [cloudUsageBytes, setCloudUsageBytes] = useState(0);
  const [cloudLibraryLoading, setCloudLibraryLoading] = useState(false);
  const [cloudLibraryError, setCloudLibraryError] = useState<string | null>(null);
  const [cloudLibraryNotice, setCloudLibraryNotice] = useState<string | null>(null);
  const [cloudUploadSubmitting, setCloudUploadSubmitting] = useState(false);
  const [cloudSaveDialogOpen, setCloudSaveDialogOpen] = useState(false);
  const [cloudSaveName, setCloudSaveName] = useState("");
  const [cloudSaveError, setCloudSaveError] = useState<string | null>(null);
  const [cloudSaveSubmitting, setCloudSaveSubmitting] = useState(false);
  const [cloudConflict, setCloudConflict] = useState<CloudScriptSummary | null>(null);
  const [supportsLocalFolderAccess] = useState(() => supportsNativeDirectoryAccess());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openLibraryOpen, setOpenLibraryOpen] = useState(false);
  const [openLibraryTab, setOpenLibraryTab] = useState<"local" | "cloud">("local");
  const [localCustomActionLibrary, setLocalCustomActionLibrary] =
    useState<LocalCustomActionLibraryState>({
      customActions: {},
      nodeIndex: {},
      sources: {},
      loadedFileCount: 0,
      loadedActionCount: 0,
      duplicateIds: [],
      skippedFiles: [],
      directoryHandle: null,
      directoryName: null,
      loading: false,
      notice: null,
      error: null,
    });
  const [localScriptLibrary, setLocalScriptLibrary] = useState<LocalScriptLibraryState>({
    directoryHandle: null,
    directoryName: null,
    tree: [],
    loading: false,
    error: null,
  });
  const [currentLocalScriptPath, setCurrentLocalScriptPath] = useState<string | null>(null);
  const [isNarrowLayout, setIsNarrowLayout] = useState(() => window.innerWidth <= 1100);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem(WORKSPACE_SPLIT_KEY);
      const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : 980;
    } catch {
      return 980;
    }
  });
  const documentSourceName = useEditorStore((state) => state.documentSourceName);
  const fileHandle = useEditorStore((state) => state.fileHandle);
  const documentOrigin = useEditorStore((state) => state.documentOrigin);
  const cloudSource = useEditorStore((state) => state.cloudSource);
  const selection = useEditorStore((state) => state.selection);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const focusedCustomActionId = useEditorStore((state) => state.focusedCustomActionId);
  const isDirty = useEditorStore((state) => state.isDirty);
  const pendingEditCount = useEditorStore((state) => state.pendingEditCount);
  const nodeIndex = useEditorStore((state) => state.nodeIndex);
  const customActions = useEditorStore((state) => state.customActions);
  const rootActionIds = useEditorStore((state) => state.rootActionIds);
  const loadDocument = useEditorStore((state) => state.loadDocument);
  const saveDocumentText = useEditorStore((state) => state.saveDocumentText);
  const setFileHandle = useEditorStore((state) => state.setFileHandle);
  const setDocumentOrigin = useEditorStore((state) => state.setDocumentOrigin);
  const setCloudSourceMetadata = useEditorStore((state) => state.setCloudSourceMetadata);
  const clearCloudSourceMetadata = useEditorStore((state) => state.clearCloudSourceMetadata);
  const setDocumentSourceName = useEditorStore((state) => state.setDocumentSourceName);
  const markSaved = useEditorStore((state) => state.markSaved);
  const insertNodeTemplate = useEditorStore((state) => state.insertNodeTemplate);
  const removeNode = useEditorStore((state) => state.removeNode);
  const setExternalCustomActionIds = useEditorStore(
    (state) => state.setExternalCustomActionIds ?? (() => {}),
  );
  const undo = useEditorStore((state) => state.undo);
  const [savePreference, setSavePreference] = useState<SavePreference>(() => {
    try {
      const stored = window.localStorage.getItem(SAVE_PREFERENCE_KEY);
      if (stored === "overwrite" || stored === "ask") {
        return stored;
      }
      return "unset";
    } catch {
      return "unset";
    }
  });
  const [savePromptMode, setSavePromptMode] = useState<SavePromptMode>("saveChoice");
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const savePromptResolverRef = useRef<((choice: SavePromptChoice) => void) | null>(null);
  const [customActionSavePromptMode, setCustomActionSavePromptMode] =
    useState<CustomActionSavePromptMode>("bothSources");
  const [customActionSavePromptOpen, setCustomActionSavePromptOpen] = useState(false);
  const customActionSavePromptResolverRef =
    useRef<((choice: CustomActionSaveChoice) => void) | null>(null);
  const [documentSaveOptionsOpen, setDocumentSaveOptionsOpen] = useState(false);
  const [documentSaveTargets, setDocumentSaveTargets] = useState({
    local: true,
    cloud: false,
  });
  const [documentSaveSubmitting, setDocumentSaveSubmitting] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isResizingRef = useRef(false);
  const effectiveCustomActions = useMemo(
    () => ({
      ...customActions,
      ...localCustomActionLibrary.customActions,
    }),
    [customActions, localCustomActionLibrary.customActions],
  );
  const effectiveCustomActionSources = useMemo<Record<string, EffectiveCustomActionSource>>(
    () =>
      buildEffectiveCustomActionSources(
        customActions,
        localCustomActionLibrary.customActions,
        localCustomActionLibrary.sources,
      ),
    [customActions, localCustomActionLibrary.customActions, localCustomActionLibrary.sources],
  );

  useEffect(() => {
    setExternalCustomActionIds(Object.keys(localCustomActionLibrary.customActions));
  }, [localCustomActionLibrary.customActions, setExternalCustomActionIds]);

  useEffect(() => {
    if (!supportsLocalFolderAccess) {
      return;
    }

    let mounted = true;

    const restoreStoredFolders = async () => {
      try {
        const [customActionHandle, scriptHandle] = await Promise.all([
          loadStoredDirectoryHandle("customActions"),
          loadStoredDirectoryHandle("scripts"),
        ]);

        if (!mounted) {
          return;
        }

        if (customActionHandle) {
          const permission = await queryDirectoryPermission(customActionHandle);
          if (!mounted) {
            return;
          }

          if (permission === "granted") {
            const loadedDirectory = await readJsonDirectory(customActionHandle);
            if (!mounted) {
              return;
            }
            const registry = loadLocalCustomActionsFromFiles(loadedDirectory.files);
            applyLoadedLocalCustomActions(
              registry,
              loadedDirectory.directoryName,
              loadedDirectory.handle,
            );
          } else {
            setLocalCustomActionLibrary((current) => ({
              ...current,
              directoryHandle: customActionHandle,
              directoryName: customActionHandle.name,
              notice: "Local custom action folder remembered. Regrant access to read it.",
              error: null,
            }));
          }
        }

        if (scriptHandle) {
          const permission = await queryDirectoryPermission(scriptHandle);
          if (!mounted) {
            return;
          }

          if (permission === "granted") {
            await refreshLocalScriptLibrary(scriptHandle);
          } else {
            setLocalScriptLibrary((current) => ({
              ...current,
              directoryHandle: scriptHandle,
              directoryName: scriptHandle.name,
              error: "Local scripts folder remembered. Regrant access to read it.",
            }));
          }
        }
      } catch (error) {
        if (!mounted) {
          return;
        }

        setLocalScriptLibrary((current) => ({
          ...current,
          error:
            error instanceof Error
              ? `Unable to restore remembered folder access: ${error.message}`
              : "Unable to restore remembered folder access.",
        }));
      }
    };

    void restoreStoredFolders();

    return () => {
      mounted = false;
    };
  }, [supportsLocalFolderAccess]);

  useEffect(() => {
    let mounted = true;

    if (!authUserId) {
      setBootState("loading");
      return () => {
        mounted = false;
      };
    }

    setBootState("loading");

    const initialize = async () => {
      try {
        const nextCatalog = await loadFunctionCatalog();

        if (!mounted) {
          return;
        }

        setCatalog(nextCatalog);

        loadDocument(createInitialDocument(), "Untitled PSC Script");
        setDocumentOrigin("unsaved");
      } catch {
        if (!mounted) {
          return;
        }

        setCatalog({
          available: false,
          sections: [],
        });
      } finally {
        if (mounted) {
          setBootState("ready");
        }
      }
    };

    void initialize();

    return () => {
      mounted = false;
    };
  }, [authUserId, loadDocument, setDocumentOrigin]);

  useEffect(() => {
    if (!auth.user) {
      setOpenLibraryOpen(false);
      setCloudScripts([]);
      setCloudUsageBytes(0);
      setCloudLibraryError(null);
      setCloudLibraryNotice(null);
      return;
    }

    setAuthSubmitting(false);
    setAuthNotice(null);
  }, [auth.user]);

  useEffect(() => {
    if (!isDirty && pendingEditCount === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, pendingEditCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVE_PREFERENCE_KEY, savePreference);
    } catch {
      // Ignore local preference persistence failures.
    }
  }, [savePreference]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_SPLIT_KEY, String(leftPaneWidth));
    } catch {
      // Ignore local preference persistence failures.
    }
  }, [leftPaneWidth]);

  useEffect(() => {
    const handleResize = () => {
      setIsNarrowLayout(window.innerWidth <= 1100);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingRef.current || !workspaceRef.current) {
        return;
      }

      const bounds = workspaceRef.current.getBoundingClientRect();
      const nextWidth = event.clientX - bounds.left;
      const clampedWidth = Math.max(320, Math.min(nextWidth, bounds.width - 320));
      setLeftPaneWidth(clampedWidth);
    };

    const stopResizing = () => {
      if (!isResizingRef.current) {
        return;
      }

      isResizingRef.current = false;
      document.body.classList.remove("app--resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.classList.remove("app--resizing");
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      );
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLElement &&
          (activeElement.isContentEditable ||
            ["input", "textarea", "select"].includes(activeElement.tagName.toLowerCase()))
        ) {
          activeElement.blur();
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          });
        }
        await handleSaveFile();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Delete" && selection.kind === "node") {
        event.preventDefault();
        removeNode(selection.editorId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [removeNode, selection, undo]);

  const refreshCloudLibrary = async () => {
    if (!auth.user) {
      setCloudScripts([]);
      setCloudUsageBytes(0);
      return;
    }

    setCloudLibraryLoading(true);
    setCloudLibraryError(null);

    try {
      const [scripts, usage] = await Promise.all([
        listUserScripts(),
        getUserStorageUsage(),
      ]);
      setCloudScripts(scripts);
      setCloudUsageBytes(usage);
    } catch (error) {
      setCloudLibraryError(
        error instanceof Error ? error.message : "Unable to load cloud scripts.",
      );
    } finally {
      setCloudLibraryLoading(false);
    }
  };

  const handleUploadCloudScripts = async () => {
    const selectedFiles = await openJsonDocuments({ multiple: true });
    if (selectedFiles.length === 0) {
      return;
    }

    setCloudUploadSubmitting(true);
    setCloudLibraryError(null);
    setCloudLibraryNotice(null);

    let uploadedCount = 0;
    const failures: string[] = [];

    try {
      for (const file of selectedFiles) {
        try {
          parseDocumentText(file.text);
          await createUserScript(file.fileName, file.text, getJsonSizeBytes(file.text));
          uploadedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to upload this file.";
          failures.push(`${file.fileName}: ${message}`);
        }
      }

      await refreshCloudLibrary();

      if (uploadedCount > 0) {
        setCloudLibraryNotice(
          `Uploaded ${uploadedCount} script${uploadedCount === 1 ? "" : "s"} to your cloud library.`,
        );
      }

      if (failures.length > 0) {
        setCloudLibraryError(failures.join(" "));
      }
    } finally {
      setCloudUploadSubmitting(false);
    }
  };

  const applyLoadedLocalCustomActions = (
    registry: LocalCustomActionRegistry,
    directoryName: string | null,
    directoryHandle: FileSystemDirectoryHandle | null,
  ) => {
    const duplicateSummary =
      registry.duplicateIds.length > 0
        ? ` ${registry.duplicateIds.length} duplicate id${
            registry.duplicateIds.length === 1 ? "" : "s"
          } resolved by last file path.`
        : "";
    const skippedSummary =
      registry.skippedFiles.length > 0
        ? ` Skipped ${registry.skippedFiles.length} file${
            registry.skippedFiles.length === 1 ? "" : "s"
          } that were not PSC custom-action JSON.`
        : "";

    setLocalCustomActionLibrary({
      ...registry,
      directoryHandle,
      directoryName,
      loading: false,
      notice:
        registry.loadedActionCount > 0
          ? `Loaded ${Object.keys(registry.customActions).length} local custom action${
              Object.keys(registry.customActions).length === 1 ? "" : "s"
            } from ${directoryName ?? "selected folder"}.${duplicateSummary}${skippedSummary}`
          : `No local custom actions found in ${directoryName ?? "selected folder"}.${skippedSummary}`,
      error: null,
    });
  };

  const handleChooseLocalCustomActionFolder = async () => {
    setLocalCustomActionLibrary((current) => ({
      ...current,
      loading: true,
      notice: null,
      error: null,
    }));

    try {
      const loadedDirectory = await openJsonDirectory();
      if (!loadedDirectory) {
        setLocalCustomActionLibrary((current) => ({
          ...current,
          loading: false,
        }));
        return;
      }

      if (loadedDirectory.handle) {
        await storeDirectoryHandle("customActions", loadedDirectory.handle);
      }

      const registry = loadLocalCustomActionsFromFiles(loadedDirectory.files);
      applyLoadedLocalCustomActions(
        registry,
        loadedDirectory.directoryName,
        loadedDirectory.handle,
      );
    } catch (error) {
      setLocalCustomActionLibrary((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load local custom action folder.",
      }));
    }
  };

  const handleRefreshLocalCustomActionFolder = async () => {
    if (!localCustomActionLibrary.directoryHandle) {
      await handleChooseLocalCustomActionFolder();
      return;
    }

    setLocalCustomActionLibrary((current) => ({
      ...current,
      loading: true,
      notice: null,
      error: null,
    }));

    try {
      const permission = await requestDirectoryPermission(localCustomActionLibrary.directoryHandle);
      if (permission !== "granted") {
        setLocalCustomActionLibrary((current) => ({
          ...current,
          loading: false,
          error: "Folder access was not granted.",
        }));
        return;
      }

      const loadedDirectory = await readJsonDirectory(localCustomActionLibrary.directoryHandle);
      const registry = loadLocalCustomActionsFromFiles(loadedDirectory.files);
      applyLoadedLocalCustomActions(
        registry,
        loadedDirectory.directoryName,
        loadedDirectory.handle,
      );
    } catch (error) {
      setLocalCustomActionLibrary((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh local custom action folder.",
      }));
    }
  };

  const handleClearLocalCustomActionFolder = () => {
    void clearStoredDirectoryHandle("customActions");
    setLocalCustomActionLibrary({
      customActions: {},
      nodeIndex: {},
      sources: {},
      loadedFileCount: 0,
      loadedActionCount: 0,
      duplicateIds: [],
      skippedFiles: [],
      directoryHandle: null,
      directoryName: null,
      loading: false,
      notice: null,
      error: null,
    });
  };

  const refreshLocalScriptLibrary = async (directoryHandle: FileSystemDirectoryHandle) => {
    setLocalScriptLibrary((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const permission = await requestDirectoryPermission(directoryHandle);
      if (permission !== "granted") {
        setLocalScriptLibrary((current) => ({
          ...current,
          directoryHandle,
          directoryName: directoryHandle.name,
          loading: false,
          error: "Folder access was not granted.",
        }));
        return;
      }

      const tree = await readJsonDirectoryTree(directoryHandle);
      setLocalScriptLibrary({
        directoryHandle,
        directoryName: directoryHandle.name,
        tree,
        loading: false,
        error: null,
      });
    } catch (error) {
      setLocalScriptLibrary((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to read the local scripts folder.",
      }));
    }
  };

  const handleChooseLocalScriptFolder = async () => {
    try {
      const loadedDirectory = await openJsonDirectory();
      if (!loadedDirectory?.handle) {
        return;
      }

      await storeDirectoryHandle("scripts", loadedDirectory.handle);
      await refreshLocalScriptLibrary(loadedDirectory.handle);
    } catch (error) {
      setLocalScriptLibrary((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to access the local scripts folder.",
      }));
    }
  };

  const handleOpenLocalScript = async (fileHandle: FileSystemFileHandle, path: string) => {
    try {
      const text = await readTextFileHandle(fileHandle);
      loadDocument(parseDocumentText(text), fileHandle.name);
      setFileHandle(fileHandle);
      setDocumentSourceName(fileHandle.name);
      setCurrentLocalScriptPath(path);
      clearCloudSourceMetadata();
      setDocumentOrigin("local");
      setOpenLibraryOpen(false);
    } catch (error) {
      setLocalScriptLibrary((current) => ({
        ...current,
        error:
          error instanceof Error
            ? `Unable to open ${path}: ${error.message}`
            : `Unable to open ${path}.`,
      }));
    }
  };

  const resolveInsertionTarget = () => {
    if (selection.kind === "node") {
      const selectedNode = useEditorStore.getState().nodeIndex[selection.editorId];
      const owner = selectedNode.ownerCustomActionId;
      return {
        targetParentEditorId: selection.editorId,
        ownerCustomActionId: owner,
        readOnly:
          owner ? effectiveCustomActionSources[owner]?.source === "local" : false,
      };
    }

    if (selection.kind === "customAction") {
      return {
        targetParentEditorId: null,
        ownerCustomActionId: selection.customActionId,
        readOnly: effectiveCustomActionSources[selection.customActionId]?.source === "local",
      };
    }

    if (activeTabId.startsWith("customAction:")) {
      const customActionId = activeTabId.slice("customAction:".length);
      return {
        targetParentEditorId: null,
        ownerCustomActionId: customActionId,
        readOnly: effectiveCustomActionSources[customActionId]?.source === "local",
      };
    }

    if (focusedCustomActionId && activeTabId === "customActions") {
      return {
        targetParentEditorId: null,
        ownerCustomActionId: focusedCustomActionId,
        readOnly: effectiveCustomActionSources[focusedCustomActionId]?.source === "local",
      };
    }

    return {
      targetParentEditorId: null,
      ownerCustomActionId: null,
      readOnly: false,
    };
  };

  const handleInsertCatalogNode = (nodeTemplate: PscNode) => {
    const target = resolveInsertionTarget();
    if (target.readOnly) {
      window.alert("Local custom actions are read-only in PSC Studio. Edit the source JSON file instead.");
      return;
    }
    insertNodeTemplate(
      nodeTemplate,
      target.targetParentEditorId,
      target.ownerCustomActionId,
    );
  };

  const handleOpenFile = async () => {
    setOpenLibraryTab("local");
    setOpenLibraryOpen(true);

    if (localScriptLibrary.directoryHandle) {
      await refreshLocalScriptLibrary(localScriptLibrary.directoryHandle);
    }
  };

  const promptSaveChoice = (mode: SavePromptMode) =>
    new Promise<SavePromptChoice>((resolve) => {
      setSavePromptMode(mode);
      savePromptResolverRef.current = resolve;
      setSavePromptOpen(true);
    });

  const handleSavePromptChoice = (choice: SavePromptChoice) => {
    setSavePromptOpen(false);
    savePromptResolverRef.current?.(choice);
    savePromptResolverRef.current = null;
  };

  const promptCustomActionSaveChoice = (mode: CustomActionSavePromptMode) =>
    new Promise<CustomActionSaveChoice>((resolve) => {
      setCustomActionSavePromptMode(mode);
      customActionSavePromptResolverRef.current = resolve;
      setCustomActionSavePromptOpen(true);
    });

  const handleCustomActionSavePromptChoice = (choice: CustomActionSaveChoice) => {
    setCustomActionSavePromptOpen(false);
    customActionSavePromptResolverRef.current?.(choice);
    customActionSavePromptResolverRef.current = null;
  };

  const executeDocumentSaveTargets = async () => {
    if (!documentSaveTargets.local && !documentSaveTargets.cloud) {
      window.alert("Select at least one save target.");
      return;
    }

    setDocumentSaveSubmitting(true);
    try {
      if (documentSaveTargets.local) {
        await saveCurrentDocument();
      }

      if (documentSaveTargets.cloud) {
        await handleSaveToAccount();
      }

      setDocumentSaveOptionsOpen(false);
    } finally {
      setDocumentSaveSubmitting(false);
    }
  };

  const saveCurrentDocument = async () => {
    const text = saveDocumentText();

    if (localScriptLibrary.directoryHandle) {
      const targetFileName =
        fileHandle?.name ??
        (documentSourceName.endsWith(".json") ? documentSourceName : `${documentSourceName}.json`);
      const exactPathMatch = currentLocalScriptPath
        ? findLocalScriptNodeByPath(localScriptLibrary.tree, currentLocalScriptPath)
        : null;
      const nameMatches = exactPathMatch
        ? [exactPathMatch]
        : findLocalScriptNodesByName(localScriptLibrary.tree, targetFileName);
      const existingTarget = nameMatches[0] ?? null;
      const nextHandle = existingTarget
        ? (await writeTextToFileHandle(existingTarget.handle, text), existingTarget.handle)
        : await writeJsonFileInDirectory(
            localScriptLibrary.directoryHandle,
            targetFileName,
            text,
          );
      setFileHandle(nextHandle);
      setDocumentSourceName(nextHandle.name);
      setCurrentLocalScriptPath(existingTarget?.path ?? targetFileName);
      markSaved(text);
      if (!cloudSource) {
        setDocumentOrigin("local");
      }
      await refreshLocalScriptLibrary(localScriptLibrary.directoryHandle);
      return;
    }

    const saveAsNewFile = async () => {
      const nextHandle = await saveJsonDocument(documentSourceName, text, null);
      if (nextHandle) {
        setFileHandle(nextHandle);
        setDocumentSourceName(nextHandle.name);
        markSaved(text);
        if (!cloudSource) {
          setDocumentOrigin("local");
        }
        return;
      }

      if (!supportsNativeFileAccess()) {
        markSaved(text);
        if (!cloudSource) {
          setDocumentOrigin("local");
        }
      }
    };

    const overwriteCurrentFile = async () => {
      const nextHandle = await saveJsonDocument(documentSourceName, text, fileHandle);
      if (nextHandle) {
        setFileHandle(nextHandle);
        setDocumentSourceName(nextHandle.name);
        markSaved(text);
        if (!cloudSource) {
          setDocumentOrigin("local");
        }
      } else {
        setFileHandle(fileHandle);
      }
    };

    if (!fileHandle) {
      await saveAsNewFile();
      return;
    }

    if (savePreference === "overwrite") {
      await overwriteCurrentFile();
      return;
    }

    if (savePreference === "unset") {
      const initialChoice = await promptSaveChoice("initialPreference");

      if (initialChoice === "overwriteAlways") {
        setSavePreference("overwrite");
        await overwriteCurrentFile();
        return;
      }

      if (initialChoice === "askEveryTime") {
        setSavePreference("ask");
        await overwriteCurrentFile();
        return;
      }

      if (initialChoice === "saveAs") {
        await saveAsNewFile();
      }

      return;
    }

    const choice = await promptSaveChoice("saveChoice");

    if (choice === "overwrite") {
      await overwriteCurrentFile();
      return;
    }

    if (choice === "overwriteAlways") {
      setSavePreference("overwrite");
      await overwriteCurrentFile();
      return;
    }

    if (choice === "saveAs") {
      await saveAsNewFile();
    }
  };

  const saveCustomActionToLocal = async (customActionId: string) => {
    const action =
      effectiveCustomActions[customActionId] ?? useEditorStore.getState().customActions[customActionId];
    if (!action) {
      throw new Error("Custom action is not available.");
    }

    const sourceInfo = localCustomActionLibrary.sources[customActionId] ?? null;
    const nodeIndexForAction =
      localCustomActionLibrary.customActions[customActionId] ? localCustomActionLibrary.nodeIndex : nodeIndex;
    const serializedAction = serializeCustomActionEntity(action, nodeIndexForAction);

    if (sourceInfo?.fileHandle) {
      if (sourceInfo.fileFormat === "standalone") {
        await writeTextToFileHandle(sourceInfo.fileHandle, JSON.stringify(serializedAction, null, 2));
      } else {
        const currentText = await (await sourceInfo.fileHandle.getFile()).text();
        const parsed = JSON.parse(currentText) as Record<string, unknown>;
        const existingCustomActions =
          parsed.customActions && typeof parsed.customActions === "object" && !Array.isArray(parsed.customActions)
            ? (parsed.customActions as Record<string, unknown>)
            : {};

        await writeTextToFileHandle(
          sourceInfo.fileHandle,
          JSON.stringify(
            {
              ...parsed,
              customActions: {
                ...existingCustomActions,
                [customActionId]: serializedAction,
              },
            },
            null,
            2,
          ),
        );
      }

      await handleRefreshLocalCustomActionFolder();
      return;
    }

    let directoryHandle = localCustomActionLibrary.directoryHandle;
    if (!directoryHandle) {
      const loadedDirectory = await openJsonDirectory();
      if (!loadedDirectory?.handle) {
        throw new Error("Folder access is required to save a local custom action copy.");
      }

      const registry = loadLocalCustomActionsFromFiles(loadedDirectory.files);
      applyLoadedLocalCustomActions(
        registry,
        loadedDirectory.directoryName,
        loadedDirectory.handle,
      );
      await storeDirectoryHandle("customActions", loadedDirectory.handle);
      directoryHandle = loadedDirectory.handle;
    }

    const nextFileName = sanitizeCustomActionFileName(String(action.raw.name ?? ""), customActionId);
    await writeJsonFileInDirectory(
      directoryHandle,
      nextFileName,
      JSON.stringify(serializedAction, null, 2),
    );
    await handleRefreshLocalCustomActionFolder();
  };

  const handleSaveActiveCustomAction = async () => {
    const activeCustomActionId = activeTabId.startsWith("customAction:")
      ? activeTabId.slice("customAction:".length)
      : null;

    if (!activeCustomActionId) {
      await saveCurrentDocument();
      return;
    }

    const hasEmbeddedCopy = Boolean(customActions[activeCustomActionId]);
    const hasLocalCopy = Boolean(localCustomActionLibrary.customActions[activeCustomActionId]);

    if (hasLocalCopy && hasEmbeddedCopy) {
      const choice = await promptCustomActionSaveChoice("bothSources");
      if (choice === "localOnly") {
        await saveCustomActionToLocal(activeCustomActionId);
      } else if (choice === "bakedOnly") {
        await saveCurrentDocument();
      } else if (choice === "both") {
        await saveCustomActionToLocal(activeCustomActionId);
        await saveCurrentDocument();
      }
      return;
    }

    if (hasEmbeddedCopy && !hasLocalCopy) {
      const choice = await promptCustomActionSaveChoice("bakedOnlyNoLocal");
      if (choice === "localOnly") {
        await saveCustomActionToLocal(activeCustomActionId);
      } else if (choice === "bakedOnly") {
        await saveCurrentDocument();
      } else if (choice === "both") {
        await saveCustomActionToLocal(activeCustomActionId);
        await saveCurrentDocument();
      }
      return;
    }

    if (hasLocalCopy) {
      await saveCustomActionToLocal(activeCustomActionId);
      return;
    }

    await saveCurrentDocument();
  };

  const handleSaveFile = async () => {
    const { invalidEditCount: currentInvalidEditCount, pendingEditCount: currentPendingEditCount } =
      useEditorStore.getState();

    if (currentInvalidEditCount > 0) {
      window.alert("Resolve invalid inspector values before saving.");
      return;
    }

    if (currentPendingEditCount > 0) {
      window.alert("Commit the current field before saving.");
      return;
    }

    try {
      if (activeTabId.startsWith("customAction:")) {
        await handleSaveActiveCustomAction();
        return;
      }

      setDocumentSaveOptionsOpen(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to save right now.");
    }
  };

  const handleRequestMagicLink = async () => {
    const email = authEmail.trim();
    if (!email) {
      setAuthNotice({
        tone: "error",
        text: "Enter the email address that was given access to PSC Studio.",
      });
      return;
    }

    setAuthSubmitting(true);
    setAuthNotice(null);
    try {
      await auth.signInWithMagicLink(email);
      setAuthNotice({
        tone: "success",
        text: "If that email has access, a magic link has been sent. Check your inbox to continue.",
      });
    } catch {
      setAuthNotice({
        tone: "error",
        text: "Unable to start sign-in right now. Try again in a moment.",
      });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setOpenLibraryOpen(false);
      setBootState("loading");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to sign out.");
    }
  };

  const handleOpenCloudLibrary = async () => {
    if (!auth.user) {
      return;
    }

    setOpenLibraryTab("cloud");
    setOpenLibraryOpen(true);
    setCloudLibraryError(null);
    setCloudLibraryNotice(null);
    await refreshCloudLibrary();
  };

  const loadCloudDocument = async (scriptId: string) => {
    const cloudScript = await getUserScript(scriptId);
    loadDocument(parseDocumentText(cloudScript.jsonText), cloudScript.name);
    setFileHandle(null);
    setCurrentLocalScriptPath(null);
    setCloudSourceMetadata({
      cloudScriptId: cloudScript.id,
      cloudRevisionUpdatedAt: cloudScript.updatedAt,
      cloudScriptName: cloudScript.name,
    });
    setDocumentSourceName(cloudScript.name);
    setDocumentOrigin("cloud");
    setOpenLibraryOpen(false);
  };

  const handleOpenCloudScript = async (scriptId: string) => {
    try {
      await loadCloudDocument(scriptId);
    } catch (error) {
      setCloudLibraryError(
        error instanceof Error ? error.message : "Unable to open cloud script.",
      );
    }
  };

  const handleDeleteCloudScript = async (scriptId: string, scriptName: string) => {
    const shouldDelete = window.confirm(`Delete "${scriptName}" from My Scripts?`);
    if (!shouldDelete) {
      return;
    }

    try {
      await deleteUserScript(scriptId);
      if (cloudSource?.cloudScriptId === scriptId) {
        clearCloudSourceMetadata();
        if (documentOrigin === "cloud") {
          setDocumentOrigin("unsaved");
        }
      }
      await refreshCloudLibrary();
    } catch (error) {
      setCloudLibraryError(
        error instanceof Error ? error.message : "Unable to delete cloud script.",
      );
    }
  };

  const handleSaveToAccount = async () => {
    if (!auth.user) {
      return;
    }

    const currentState = useEditorStore.getState();
    if (currentState.invalidEditCount > 0) {
      window.alert("Resolve invalid inspector values before saving.");
      return;
    }

    if (currentState.pendingEditCount > 0) {
      window.alert("Commit the current field before saving.");
      return;
    }

    if (cloudSource) {
      const jsonText = saveDocumentText();
      setCloudSaveSubmitting(true);
      try {
        const updated = await updateUserScript(
          cloudSource.cloudScriptId,
          jsonText,
          getJsonSizeBytes(jsonText),
          cloudSource.cloudRevisionUpdatedAt,
        );
        setCloudSourceMetadata({
          cloudScriptId: updated.id,
          cloudRevisionUpdatedAt: updated.updatedAt,
          cloudScriptName: updated.name,
        });
        setDocumentSourceName(updated.name);
        markSaved(jsonText);
        setDocumentOrigin("cloud");
        if (openLibraryOpen && openLibraryTab === "cloud") {
          await refreshCloudLibrary();
        }
      } catch (error) {
        if (error instanceof CloudScriptConflictError) {
          setCloudConflict(error.latestSummary);
        } else {
          window.alert(error instanceof Error ? error.message : "Unable to save to account.");
        }
      } finally {
        setCloudSaveSubmitting(false);
      }
      return;
    }

    setCloudSaveName(documentSourceName.replace(/\.json$/i, ""));
    setCloudSaveError(null);
    setCloudSaveDialogOpen(true);
  };

  const handleCreateCloudScript = async () => {
    const name = cloudSaveName.trim();
    if (!name) {
      setCloudSaveError("Enter a script name.");
      return;
    }

    const currentState = useEditorStore.getState();
    if (currentState.invalidEditCount > 0 || currentState.pendingEditCount > 0) {
      setCloudSaveError("Resolve or commit current edits before saving to account.");
      return;
    }

    const jsonText = saveDocumentText();
    setCloudSaveSubmitting(true);
    setCloudSaveError(null);

    try {
      const created = await createUserScript(name.endsWith(".json") ? name : `${name}.json`, jsonText);
      setCloudSourceMetadata({
        cloudScriptId: created.id,
        cloudRevisionUpdatedAt: created.updatedAt,
        cloudScriptName: created.name,
      });
      setDocumentSourceName(created.name);
      markSaved(jsonText);
      setDocumentOrigin("cloud");
      setCloudSaveDialogOpen(false);
      if (openLibraryOpen && openLibraryTab === "cloud") {
        await refreshCloudLibrary();
      }
    } catch (error) {
      setCloudSaveError(error instanceof Error ? error.message : "Unable to save to account.");
    } finally {
      setCloudSaveSubmitting(false);
    }
  };

  const handleOverwriteCloudConflict = async () => {
    if (!cloudSource) {
      setCloudConflict(null);
      return;
    }

    const jsonText = saveDocumentText();
    setCloudSaveSubmitting(true);
    try {
      const updated = await updateUserScript(
        cloudSource.cloudScriptId,
        jsonText,
        getJsonSizeBytes(jsonText),
      );
      setCloudSourceMetadata({
        cloudScriptId: updated.id,
        cloudRevisionUpdatedAt: updated.updatedAt,
        cloudScriptName: updated.name,
      });
      setDocumentSourceName(updated.name);
      markSaved(jsonText);
      setDocumentOrigin("cloud");
      setCloudConflict(null);
      if (openLibraryOpen && openLibraryTab === "cloud") {
        await refreshCloudLibrary();
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to overwrite cloud script.");
    } finally {
      setCloudSaveSubmitting(false);
    }
  };

  const handleReloadCloudConflict = async () => {
    if (!cloudConflict) {
      return;
    }

    try {
      await loadCloudDocument(cloudConflict.id);
      setCloudConflict(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to reload cloud script.");
    }
  };

  const renderLocalScriptTree = (
    nodes: JsonDirectoryTreeNode[],
    depth = 0,
  ): ReactNode[] =>
    nodes.flatMap((node) => {
      if (node.kind === "directory") {
        return [
          <div
            key={node.path}
            className="local-script-browser__directory"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            {node.name}
          </div>,
          ...renderLocalScriptTree(node.children, depth + 1),
        ];
      }

      return (
        <button
          key={node.path}
          className="local-script-browser__file"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => void handleOpenLocalScript(node.handle, node.path)}
        >
          {node.name}
        </button>
      );
    });

  if (auth.loading) {
    return <div className="boot-screen">Loading PSC Studio...</div>;
  }

  if (!auth.isConfigured) {
    return (
      <StatusScreen
        eyebrow="Configuration required"
        title="Supabase is not configured"
        text="PSC Studio cannot authenticate users in this environment yet."
        detail="Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before publishing."
      />
    );
  }

  if (auth.error) {
    return (
      <StatusScreen
        eyebrow="Authentication problem"
        title="Unable to verify your session"
        text="PSC Studio could not complete the Supabase authentication check."
        detail={auth.error}
        actionLabel="Reload page"
        onAction={() => window.location.reload()}
      />
    );
  }

  if (!auth.user) {
    return (
      <AuthGate
        email={authEmail}
        notice={authNotice}
        submitting={authSubmitting}
        onEmailChange={(email) => {
          setAuthEmail(email);
          setAuthNotice(null);
        }}
        onSubmit={handleRequestMagicLink}
      />
    );
  }

  if (bootState === "loading") {
    return <div className="boot-screen">Loading PSC Studio...</div>;
  }

  const workspaceStyle = isNarrowLayout
    ? undefined
    : {
        gridTemplateColumns: `minmax(320px, ${leftPaneWidth}px) 8px minmax(320px, 1fr)`,
      };

  return (
    <div className="app-shell">
      <MenuBar
        sourceName={documentSourceName}
        hasCatalog={catalog.available}
        catalogSections={catalog.sections}
        accountEmail={auth.user.email ?? null}
        onOpenFile={() => void handleOpenFile()}
        onSaveFile={() => void handleSaveFile()}
        onOpenCloudLibrary={() => void handleOpenCloudLibrary()}
        onOpenSettings={() => setSettingsOpen(true)}
        onSignOut={() => void handleSignOut()}
        onInsertCatalogNode={handleInsertCatalogNode}
      />

      <div className="editor-strip">
        <div className="editor-strip__title">{documentSourceName}</div>
        <div className="editor-strip__meta">Origin: {documentOrigin}</div>
        <div className="editor-strip__meta">{rootActionIds.length} root lines</div>
        <div className="editor-strip__meta">
          {Object.keys(effectiveCustomActions).length} custom actions
        </div>
        {localCustomActionLibrary.directoryName ? (
          <div className="editor-strip__meta">
            Local folder: {localCustomActionLibrary.directoryName}
          </div>
        ) : null}
        {cloudSource ? (
          <div className="editor-strip__meta">Cloud script: {cloudSource.cloudScriptName}</div>
        ) : null}
      </div>

      <main className="workspace" ref={workspaceRef} style={workspaceStyle}>
        <div className="workspace__left">
          <ScriptTree
            customActions={effectiveCustomActions}
            customActionSources={effectiveCustomActionSources}
            localNodeIndex={localCustomActionLibrary.nodeIndex}
            localLibraryDirectoryName={localCustomActionLibrary.directoryName}
            localLibraryError={localCustomActionLibrary.error}
            localLibraryLoading={localCustomActionLibrary.loading}
            localLibraryNotice={localCustomActionLibrary.notice}
            canRefreshLocalLibrary={Boolean(localCustomActionLibrary.directoryHandle)}
            supportsLocalFolderAccess={supportsLocalFolderAccess}
            onChooseLocalLibrary={() => void handleChooseLocalCustomActionFolder()}
            onRefreshLocalLibrary={() => void handleRefreshLocalCustomActionFolder()}
            onClearLocalLibrary={handleClearLocalCustomActionFolder}
          />
        </div>

        <div
          className="workspace__splitter"
          onPointerDown={(event) => {
            if (isNarrowLayout) {
              return;
            }

            event.preventDefault();
            isResizingRef.current = true;
            document.body.classList.add("app--resizing");
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
        />

        <div className="workspace__right">
          <Inspector
            customActions={effectiveCustomActions}
            customActionSources={effectiveCustomActionSources}
          />
        </div>
      </main>

      {openLibraryOpen ? (
        <div className="modal-backdrop" onClick={() => setOpenLibraryOpen(false)}>
          <div className="save-dialog cloud-library-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Open Script</div>
            <div className="library-view-toggle library-view-toggle--modal" role="tablist">
              <button
                className="library-view-toggle__button"
                data-state={openLibraryTab === "local" ? "active" : "inactive"}
                onClick={() => setOpenLibraryTab("local")}
                type="button"
              >
                Local Folder
              </button>
              <button
                className="library-view-toggle__button"
                data-state={openLibraryTab === "cloud" ? "active" : "inactive"}
                onClick={() => void handleOpenCloudLibrary()}
                type="button"
              >
                Cloud Saved Files
              </button>
            </div>

            {openLibraryTab === "local" ? (
              <>
                <div className="save-dialog__text">
                  {localScriptLibrary.directoryName
                    ? `Reading scripts from ${localScriptLibrary.directoryName}.`
                    : "Grant access to a local scripts folder, then browse and open JSON files directly from disk."}
                </div>
                {localScriptLibrary.error ? (
                  <div className="empty-state">{localScriptLibrary.error}</div>
                ) : null}
                <div className="local-script-browser">
                  {localScriptLibrary.loading ? (
                    <div className="empty-state">Reading local scripts...</div>
                  ) : localScriptLibrary.tree.length === 0 ? (
                    <div className="empty-state">
                      {localScriptLibrary.directoryName
                        ? "No JSON scripts found in this folder."
                        : "No local scripts folder configured yet."}
                    </div>
                  ) : (
                    renderLocalScriptTree(localScriptLibrary.tree)
                  )}
                </div>
                <div className="save-dialog__actions">
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => void handleChooseLocalScriptFolder()}
                  >
                    {localScriptLibrary.directoryName
                      ? "Regrant Script Folder"
                      : "Grant Script Folder Access"}
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() =>
                      localScriptLibrary.directoryHandle
                        ? void refreshLocalScriptLibrary(localScriptLibrary.directoryHandle)
                        : void handleChooseLocalScriptFolder()
                    }
                    disabled={localScriptLibrary.loading}
                  >
                    Re-read
                  </button>
                  <button
                    className="app-button app-button--menu app-button--ghost"
                    onClick={() => setOpenLibraryOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="save-dialog__text">
                  {cloudUsageBytes.toLocaleString()} bytes used of {CLOUD_STORAGE_QUOTA_LABEL}.
                </div>
                <div className="cloud-warning">
                  Files uploaded here are not encrypted. Do not upload sensitive files or scripts
                  you do not trust the author of this site with.
                </div>
                {cloudLibraryNotice ? (
                  <div className="empty-state empty-state--success">{cloudLibraryNotice}</div>
                ) : null}
                {cloudLibraryError ? <div className="empty-state">{cloudLibraryError}</div> : null}
                <div className="cloud-library">
                  {cloudLibraryLoading ? (
                    <div className="empty-state">Loading cloud scripts...</div>
                  ) : cloudScripts.length === 0 ? (
                    <div className="empty-state">No scripts saved to this account yet.</div>
                  ) : (
                    cloudScripts.map((script) => (
                      <div key={script.id} className="cloud-library__row">
                        <div className="cloud-library__main">
                          <div className="cloud-library__name">{script.name}</div>
                          <div className="cloud-library__meta">
                            {script.sizeBytes.toLocaleString()} bytes updated{" "}
                            {new Date(script.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="cloud-library__actions">
                          <button
                            className="app-button app-button--menu"
                            onClick={() => void handleOpenCloudScript(script.id)}
                          >
                            Open
                          </button>
                          <button
                            className="app-button app-button--menu app-button--ghost"
                            onClick={() => void handleDeleteCloudScript(script.id, script.name)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="save-dialog__actions">
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => void handleUploadCloudScripts()}
                    disabled={cloudUploadSubmitting}
                  >
                    {cloudUploadSubmitting ? "Uploading..." : "Upload JSON"}
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => void refreshCloudLibrary()}
                    disabled={cloudUploadSubmitting}
                  >
                    Refresh
                  </button>
                  <button
                    className="app-button app-button--menu app-button--ghost"
                    onClick={() => setOpenLibraryOpen(false)}
                    disabled={cloudUploadSubmitting}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Settings</div>
            <div className="save-dialog__text">
              Choose the local folder PSC Studio should use for saving and browsing script files.
            </div>
            <div className="settings-block">
              <div className="settings-block__title">Local Scripts Folder</div>
              <div className="settings-block__value">
                {localScriptLibrary.directoryName ?? "No folder access granted."}
              </div>
              {localScriptLibrary.error ? (
                <div className="empty-state">{localScriptLibrary.error}</div>
              ) : null}
            </div>
            <div className="save-dialog__actions">
              <button
                className="app-button app-button--menu app-button--accent"
                onClick={() => void handleChooseLocalScriptFolder()}
                disabled={!supportsLocalFolderAccess}
              >
                {localScriptLibrary.directoryName
                  ? "Change Scripts Folder"
                  : "Grant Scripts Folder Access"}
              </button>
              <button
                className="app-button app-button--menu"
                onClick={() =>
                  localScriptLibrary.directoryHandle
                    ? void refreshLocalScriptLibrary(localScriptLibrary.directoryHandle)
                    : void handleChooseLocalScriptFolder()
                }
                disabled={!supportsLocalFolderAccess}
              >
                Re-read Folder
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {documentSaveOptionsOpen ? (
        <div className="modal-backdrop" onClick={() => setDocumentSaveOptionsOpen(false)}>
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Save Document</div>
            <div className="save-dialog__text">
              Choose where this script should be saved. These selections are remembered for the
              current session.
            </div>
            <label className="save-target-option">
              <input
                type="checkbox"
                checked={documentSaveTargets.local}
                onChange={(event) =>
                  setDocumentSaveTargets((current) => ({
                    ...current,
                    local: event.target.checked,
                  }))
                }
              />
              <span>Save local</span>
            </label>
            <label className="save-target-option">
              <input
                type="checkbox"
                checked={documentSaveTargets.cloud}
                onChange={(event) =>
                  setDocumentSaveTargets((current) => ({
                    ...current,
                    cloud: event.target.checked,
                  }))
                }
              />
              <span>Save to cloud account</span>
            </label>
            <div className="save-dialog__actions">
              <button
                className="app-button app-button--menu app-button--accent"
                onClick={() => void executeDocumentSaveTargets()}
                disabled={documentSaveSubmitting}
              >
                {documentSaveSubmitting ? "Saving..." : "Save"}
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setDocumentSaveOptionsOpen(false)}
                disabled={documentSaveSubmitting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cloudSaveDialogOpen ? (
        <div className="modal-backdrop" onClick={() => setCloudSaveDialogOpen(false)}>
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Save to account</div>
            <div className="save-dialog__text">
              Save this PSC JSON document to your account as a cloud script.
            </div>
            <div className="cloud-warning">
              Cloud scripts are not encrypted. Do not upload sensitive files or scripts you do not
              trust the author of this site with.
            </div>
            <label className="field">
              <span className="field__label">Script name</span>
              <input
                className="editor-input"
                value={cloudSaveName}
                onChange={(event) => setCloudSaveName(event.target.value)}
                placeholder="MyScript.json"
              />
            </label>
            {cloudSaveError ? <div className="empty-state">{cloudSaveError}</div> : null}
            <div className="save-dialog__actions">
              <button
                className="app-button app-button--menu app-button--accent"
                onClick={() => void handleCreateCloudScript()}
                disabled={cloudSaveSubmitting}
              >
                {cloudSaveSubmitting ? "Saving..." : "Save as new account script"}
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setCloudSaveDialogOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cloudConflict ? (
        <div className="modal-backdrop" onClick={() => setCloudConflict(null)}>
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Cloud script changed</div>
            <div className="save-dialog__text">
              The account copy of "{cloudConflict.name}" changed since you loaded it. Reload the remote copy or overwrite it with your current editor content.
            </div>
            <div className="save-dialog__actions">
              <button
                className="app-button app-button--menu"
                onClick={() => void handleReloadCloudConflict()}
              >
                Reload remote copy
              </button>
              <button
                className="app-button app-button--menu app-button--accent"
                onClick={() => void handleOverwriteCloudConflict()}
              >
                Overwrite anyway
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setCloudConflict(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customActionSavePromptOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => handleCustomActionSavePromptChoice("cancel")}
        >
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Save active custom action</div>
            <div className="save-dialog__text">
              {customActionSavePromptMode === "bakedOnlyNoLocal"
                ? "This custom action only exists inside the loaded script. Save the baked script copy, create a local custom-action file, or do both."
                : "This custom action exists both as a local file and inside the loaded script. Choose which target should receive the current custom-action content."}
            </div>
            <div className="save-dialog__actions">
              {customActionSavePromptMode === "bakedOnlyNoLocal" ? (
                <>
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => handleCustomActionSavePromptChoice("localOnly")}
                  >
                    Save local copy
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleCustomActionSavePromptChoice("bakedOnly")}
                  >
                    Save script baked only
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleCustomActionSavePromptChoice("both")}
                  >
                    Save local & baked
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => handleCustomActionSavePromptChoice("localOnly")}
                  >
                    Save only local
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleCustomActionSavePromptChoice("bakedOnly")}
                  >
                    Save script baked only
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleCustomActionSavePromptChoice("both")}
                  >
                    Save local & baked
                  </button>
                </>
              )}
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => handleCustomActionSavePromptChoice("cancel")}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {savePromptOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => handleSavePromptChoice("cancel")}
        >
          <div
            className="save-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="save-dialog__title">Save "{documentSourceName}"</div>
            <div className="save-dialog__text">
              {savePromptMode === "initialPreference"
                ? "For this file, should Save overwrite it directly from now on? Choosing this avoids the Windows save dialog on later saves."
                : "Overwrite the current file or save this document as a new file."}
            </div>
            <div className="save-dialog__actions">
              {savePromptMode === "initialPreference" ? (
                <>
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => handleSavePromptChoice("overwriteAlways")}
                  >
                    Yes, always overwrite
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleSavePromptChoice("askEveryTime")}
                  >
                    Ask me each time
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleSavePromptChoice("saveAs")}
                  >
                    Save as new file
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="app-button app-button--menu app-button--accent"
                    onClick={() => handleSavePromptChoice("overwrite")}
                  >
                    Overwrite file
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleSavePromptChoice("saveAs")}
                  >
                    Save as new file
                  </button>
                  <button
                    className="app-button app-button--menu"
                    onClick={() => handleSavePromptChoice("overwriteAlways")}
                  >
                    Yes, never ask again
                  </button>
                </>
              )}
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => handleSavePromptChoice("cancel")}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
