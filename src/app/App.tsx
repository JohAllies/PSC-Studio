import { useEffect, useMemo, useRef, useState } from "react";
import sampleLargeUrl from "../../rework_KiwiB.json?url";
import sampleSimpleUrl from "../../psc-simple-variable-script.json?url";
import sampleLoopUrl from "../../psc-for-loop-log-script.json?url";
import sampleCombatUrl from "../../psc-kill-chickens-script.json?url";
import { MenuBar } from "../components/MenuBar";
import { ScriptTree } from "../components/ScriptTree";
import { Inspector } from "../components/Inspector";
import { loadFunctionCatalog, type PscFunctionCatalog } from "../lib/psc/catalog";
import { useSupabaseAuth } from "../lib/supabase/auth";
import {
  openJsonDocument,
  saveJsonDocument,
  supportsNativeFileAccess,
} from "../lib/file-system";
import { formatTreeNodeLabel } from "../lib/psc/labels";
import { parseDocumentText } from "../lib/psc/parse";
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

const samples = {
  large: {
    label: "KiwiB Stress Test",
    url: sampleLargeUrl,
  },
  simple: {
    label: "Simple Variables",
    url: sampleSimpleUrl,
  },
  loop: {
    label: "Loop + Logging",
    url: sampleLoopUrl,
  },
  combat: {
    label: "Kill Chickens",
    url: sampleCombatUrl,
  },
} as const;

const fetchSampleText = async (sampleUrl: string) => {
  const response = await fetch(sampleUrl);
  if (!response.ok) {
    throw new Error(`Unable to load bundled sample: ${sampleUrl}`);
  }

  return response.text();
};

type SavePreference = "unset" | "ask" | "overwrite";
type SavePromptMode = "initialPreference" | "saveChoice";
type SavePromptChoice =
  | "overwrite"
  | "overwriteAlways"
  | "askEveryTime"
  | "saveAs"
  | "cancel";
const SAVE_PREFERENCE_KEY = "psc-studio-save-preference";
const WORKSPACE_SPLIT_KEY = "psc-studio-workspace-split";
const CLOUD_STORAGE_QUOTA_LABEL = "25MB";

export const App = () => {
  const auth = useSupabaseAuth();
  const [catalog, setCatalog] = useState<PscFunctionCatalog>({
    available: false,
    sections: [],
  });
  const [bootState, setBootState] = useState<"loading" | "ready">("loading");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [cloudLibraryOpen, setCloudLibraryOpen] = useState(false);
  const [cloudScripts, setCloudScripts] = useState<CloudScriptSummary[]>([]);
  const [cloudUsageBytes, setCloudUsageBytes] = useState(0);
  const [cloudLibraryLoading, setCloudLibraryLoading] = useState(false);
  const [cloudLibraryError, setCloudLibraryError] = useState<string | null>(null);
  const [cloudSaveDialogOpen, setCloudSaveDialogOpen] = useState(false);
  const [cloudSaveName, setCloudSaveName] = useState("");
  const [cloudSaveError, setCloudSaveError] = useState<string | null>(null);
  const [cloudSaveSubmitting, setCloudSaveSubmitting] = useState(false);
  const [cloudConflict, setCloudConflict] = useState<CloudScriptSummary | null>(null);
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
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      const nextCatalog = await loadFunctionCatalog();

      if (!mounted) {
        return;
      }

      setCatalog(nextCatalog);

      const initialText = await fetchSampleText(samples.large.url);
      const initialName = "rework_KiwiB.json";
      loadDocument(parseDocumentText(initialText), initialName);
      setDocumentOrigin("sample");
      setBootState("ready");
    };

    void initialize();

    return () => {
      mounted = false;
    };
  }, [loadDocument, setDocumentOrigin]);

  useEffect(() => {
    if (!auth.user) {
      setCloudLibraryOpen(false);
      setCloudScripts([]);
      setCloudUsageBytes(0);
    }
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

  const sampleOptions = useMemo(
    () =>
      Object.entries(samples).map(([id, sample]) => ({
        id,
        label: sample.label,
      })),
    [],
  );

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

  const getNodeLabel = (editorId: string) => {
    const node = nodeIndex[editorId];
    if (!node) {
      return "";
    }

    return formatTreeNodeLabel(node, customActions);
  };

  const resolveInsertionTarget = () => {
    if (selection.kind === "node") {
      const owner = useEditorStore.getState().nodeIndex[selection.editorId].ownerCustomActionId;
      return {
        targetParentEditorId: selection.editorId,
        ownerCustomActionId: owner,
      };
    }

    if (selection.kind === "customAction") {
      return {
        targetParentEditorId: null,
        ownerCustomActionId: selection.customActionId,
      };
    }

    if (activeTabId.startsWith("customAction:")) {
      return {
        targetParentEditorId: null,
        ownerCustomActionId: activeTabId.slice("customAction:".length),
      };
    }

    if (focusedCustomActionId && activeTabId === "customActions") {
      return {
        targetParentEditorId: null,
        ownerCustomActionId: focusedCustomActionId,
      };
    }

    return {
      targetParentEditorId: null,
      ownerCustomActionId: null,
    };
  };

  const handleInsertCatalogNode = (nodeTemplate: PscNode) => {
    const target = resolveInsertionTarget();
    insertNodeTemplate(
      nodeTemplate,
      target.targetParentEditorId,
      target.ownerCustomActionId,
    );
  };

  const loadSample = async (sampleId: string) => {
    const sample = samples[sampleId as keyof typeof samples];
    if (!sample) {
      return;
    }

    const sampleText = await fetchSampleText(sample.url);
    loadDocument(parseDocumentText(sampleText), `${sample.label}.json`);
    setFileHandle(null);
    clearCloudSourceMetadata();
    setDocumentOrigin("sample");
  };

  const handleOpenFile = async () => {
    const loaded = await openJsonDocument();
    if (!loaded) {
      return;
    }

    loadDocument(parseDocumentText(loaded.text), loaded.fileName);
    setFileHandle(loaded.handle);
    clearCloudSourceMetadata();
    setDocumentOrigin("local");
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

    const text = saveDocumentText();

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

  const handleExport = async () => {
    await saveJsonDocument(documentSourceName, saveDocumentText(), null);
  };

  const handleOpenAuth = () => {
    setAuthMessage(null);
    setAuthEmail(auth.user?.email ?? "");
    setAuthDialogOpen(true);
  };

  const handleRequestMagicLink = async () => {
    const email = authEmail.trim();
    if (!email) {
      setAuthMessage("Enter an email address.");
      return;
    }

    setAuthSubmitting(true);
    setAuthMessage(null);
    try {
      await auth.signInWithMagicLink(email);
      setAuthMessage(`Magic link sent to ${email}.`);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Unable to send magic link.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setCloudLibraryOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to sign out.");
    }
  };

  const handleOpenCloudLibrary = async () => {
    if (!auth.isConfigured) {
      window.alert("Supabase is not configured.");
      return;
    }

    if (!auth.user) {
      handleOpenAuth();
      return;
    }

    setCloudLibraryOpen(true);
    await refreshCloudLibrary();
  };

  const loadCloudDocument = async (scriptId: string) => {
    const cloudScript = await getUserScript(scriptId);
    loadDocument(parseDocumentText(cloudScript.jsonText), cloudScript.name);
    setFileHandle(null);
    setCloudSourceMetadata({
      cloudScriptId: cloudScript.id,
      cloudRevisionUpdatedAt: cloudScript.updatedAt,
      cloudScriptName: cloudScript.name,
    });
    setDocumentSourceName(cloudScript.name);
    setDocumentOrigin("cloud");
    setCloudLibraryOpen(false);
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

  const handleDeleteCloudScript = async (scriptId: string) => {
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
    if (!auth.isConfigured) {
      window.alert("Supabase is not configured.");
      return;
    }

    if (!auth.user) {
      handleOpenAuth();
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
        if (cloudLibraryOpen) {
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
      if (cloudLibraryOpen) {
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
      if (cloudLibraryOpen) {
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
        authConfigured={auth.isConfigured}
        authLoading={auth.loading}
        accountEmail={auth.user?.email ?? null}
        onOpenFile={() => void handleOpenFile()}
        onSaveFile={() => void handleSaveFile()}
        onSaveToAccount={() => void handleSaveToAccount()}
        onExportFile={() => void handleExport()}
        onOpenCloudLibrary={() => void handleOpenCloudLibrary()}
        onOpenAuth={handleOpenAuth}
        onSignOut={() => void handleSignOut()}
        onLoadSample={(sampleId) => void loadSample(sampleId)}
        onInsertCatalogNode={handleInsertCatalogNode}
        samples={sampleOptions}
      />

      <div className="editor-strip">
        <div className="editor-strip__title">{documentSourceName}</div>
        <div className="editor-strip__meta">Origin: {documentOrigin}</div>
        <div className="editor-strip__meta">{rootActionIds.length} root lines</div>
        <div className="editor-strip__meta">{Object.keys(customActions).length} custom actions</div>
        {cloudSource ? (
          <div className="editor-strip__meta">Cloud script: {cloudSource.cloudScriptName}</div>
        ) : null}
      </div>

      <main className="workspace" ref={workspaceRef} style={workspaceStyle}>
        <div className="workspace__left">
          <ScriptTree getNodeLabel={getNodeLabel} />
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
          <Inspector />
        </div>
      </main>

      {authDialogOpen ? (
        <div className="modal-backdrop" onClick={() => setAuthDialogOpen(false)}>
          <div className="save-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">Sign in to PSC Studio</div>
            <div className="save-dialog__text">
              Enter your email to receive a Supabase magic link.
            </div>
            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="editor-input"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {authMessage ? <div className="empty-state">{authMessage}</div> : null}
            <div className="save-dialog__actions">
              <button
                className="app-button app-button--menu app-button--accent"
                onClick={() => void handleRequestMagicLink()}
                disabled={authSubmitting}
              >
                {authSubmitting ? "Sending..." : "Send magic link"}
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setAuthDialogOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cloudLibraryOpen ? (
        <div className="modal-backdrop" onClick={() => setCloudLibraryOpen(false)}>
          <div className="save-dialog cloud-library-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="save-dialog__title">My Scripts</div>
            <div className="save-dialog__text">
              {cloudUsageBytes.toLocaleString()} bytes used of {CLOUD_STORAGE_QUOTA_LABEL}.
            </div>
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
                        {script.sizeBytes.toLocaleString()} bytes · updated {new Date(script.updatedAt).toLocaleString()}
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
                        onClick={() => void handleDeleteCloudScript(script.id)}
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
                className="app-button app-button--menu"
                onClick={() => void refreshCloudLibrary()}
              >
                Refresh
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={() => setCloudLibraryOpen(false)}
              >
                Close
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
