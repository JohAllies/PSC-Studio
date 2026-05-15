import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const loadDocument = vi.fn();
const setDocumentOrigin = vi.fn();
const signInWithMagicLink = vi.fn();
const signOut = vi.fn();
const loadFunctionCatalog = vi.fn();
const parseDocumentText = vi.fn();
const openJsonDocuments = vi.fn();
const createUserScript = vi.fn();
const deleteUserScript = vi.fn();
const getUserStorageUsage = vi.fn();
const listUserScripts = vi.fn();

const authState = {
  session: null,
  user: null as { id: string; email?: string | null } | null,
  loading: false,
  error: null as string | null,
  isConfigured: true,
  signInWithMagicLink,
  signOut,
};

const storeState = {
  documentSourceName: "Fixture.json",
  fileHandle: null,
  documentOrigin: "sample",
  cloudSource: null,
  selection: { kind: "document" as const },
  activeTabId: "actions",
  focusedCustomActionId: null,
  isDirty: false,
  pendingEditCount: 0,
  nodeIndex: {},
  customActions: {},
  rootActionIds: [],
  loadDocument,
  saveDocumentText: vi.fn(() => "{}"),
  setFileHandle: vi.fn(),
  setDocumentOrigin,
  setCloudSourceMetadata: vi.fn(),
  clearCloudSourceMetadata: vi.fn(),
  setDocumentSourceName: vi.fn(),
  markSaved: vi.fn(),
  insertNodeTemplate: vi.fn(),
  removeNode: vi.fn(),
  undo: vi.fn(),
};

vi.mock("../lib/supabase/auth", () => ({
  useSupabaseAuth: () => authState,
}));

vi.mock("../store/editor-store", () => {
  const useEditorStore = (selector: (state: typeof storeState) => unknown) => selector(storeState);
  useEditorStore.getState = () => storeState;
  return { useEditorStore };
});

vi.mock("../components/MenuBar", () => ({
  MenuBar: ({
    accountEmail,
    onOpenCloudLibrary,
  }: {
    accountEmail: string | null;
    onOpenCloudLibrary: () => void;
  }) => (
    <div>
      <div data-testid="menu-bar">{accountEmail}</div>
      <button onClick={onOpenCloudLibrary}>My Scripts</button>
    </div>
  ),
}));

vi.mock("../components/ScriptTree", () => ({
  ScriptTree: () => <div data-testid="script-tree" />,
}));

vi.mock("../components/Inspector", () => ({
  Inspector: () => <div data-testid="inspector" />,
}));

vi.mock("../lib/psc/catalog", () => ({
  loadFunctionCatalog: (...args: unknown[]) => loadFunctionCatalog(...args),
}));

vi.mock("../lib/psc/parse", () => ({
  parseDocumentText: (...args: unknown[]) => parseDocumentText(...args),
  serializeCustomActionEntity: vi.fn(),
}));

vi.mock("../lib/file-system", () => ({
  openJsonDocuments: (...args: unknown[]) => openJsonDocuments(...args),
  openJsonDocument: vi.fn(),
  openJsonDirectory: vi.fn(),
  readJsonDirectory: vi.fn(),
  saveJsonDocument: vi.fn(),
  supportsNativeFileAccess: vi.fn(() => true),
  supportsNativeDirectoryAccess: vi.fn(() => true),
  writeJsonFileInDirectory: vi.fn(),
  writeTextToFileHandle: vi.fn(),
}));

vi.mock("../lib/supabase/scripts", () => ({
  CloudScriptConflictError: class CloudScriptConflictError extends Error {
    latestSummary = {
      id: "cloud-1",
      name: "Conflict.json",
      sizeBytes: 100,
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    };
  },
  createUserScript: (...args: unknown[]) => createUserScript(...args),
  deleteUserScript: (...args: unknown[]) => deleteUserScript(...args),
  getJsonSizeBytes: vi.fn(() => 2),
  getUserScript: vi.fn(),
  getUserStorageUsage: (...args: unknown[]) => getUserStorageUsage(...args),
  listUserScripts: (...args: unknown[]) => listUserScripts(...args),
  updateUserScript: vi.fn(),
}));

describe("App authentication gate", () => {
  beforeEach(() => {
    authState.session = null;
    authState.user = null;
    authState.loading = false;
    authState.error = null;
    authState.isConfigured = true;
    signInWithMagicLink.mockReset();
    signOut.mockReset();
    loadDocument.mockReset();
    setDocumentOrigin.mockReset();
    loadFunctionCatalog.mockReset();
    parseDocumentText.mockReset();
    openJsonDocuments.mockReset();
    createUserScript.mockReset();
    deleteUserScript.mockReset();
    getUserStorageUsage.mockReset();
    listUserScripts.mockReset();
    loadFunctionCatalog.mockResolvedValue({
      available: false,
      sections: [],
    });
    parseDocumentText.mockReturnValue({
      name: "Parsed fixture",
      actions: [],
      customActions: {},
      images: {},
    });
    openJsonDocuments.mockResolvedValue([]);
    createUserScript.mockResolvedValue({
      id: "cloud-1",
      name: "Uploaded.json",
      sizeBytes: 2,
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    });
    getUserStorageUsage.mockResolvedValue(0);
    listUserScripts.mockResolvedValue([]);
    deleteUserScript.mockResolvedValue(undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => '{"name":"Fixture"}',
      })),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders a loading screen while authentication is resolving", () => {
    authState.loading = true;

    render(<App />);

    expect(screen.getByText("Loading PSC Studio...")).toBeInTheDocument();
  });

  it("renders a blocking configuration screen when Supabase is missing", () => {
    authState.isConfigured = false;

    render(<App />);

    expect(screen.getByText("Supabase is not configured")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-bar")).not.toBeInTheDocument();
  });

  it("renders a blocking error screen when auth bootstrap fails", () => {
    authState.error = "Bootstrap failed";

    render(<App />);

    expect(screen.getByText("Unable to verify your session")).toBeInTheDocument();
    expect(screen.getByText("Bootstrap failed")).toBeInTheDocument();
  });

  it("renders the invite-only auth page and sends a magic link", async () => {
    signInWithMagicLink.mockResolvedValue(undefined);

    render(<App />);

    expect(screen.getByText("Invite-only access")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-bar")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByText("Send magic link"));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("owner@example.com");
    });

    expect(
      screen.getByText(
        "If that email has access, a magic link has been sent. Check your inbox to continue.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the editor shell only after authentication", async () => {
    authState.user = {
      id: "user-1",
      email: "owner@example.com",
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("menu-bar")).toBeInTheDocument();
    });

    expect(screen.getByTestId("script-tree")).toBeInTheDocument();
    expect(screen.getByTestId("inspector")).toBeInTheDocument();
    expect(screen.queryByText("Invite-only access")).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/samples/rework_KiwiB.json");
    expect(loadDocument).toHaveBeenCalled();
    expect(setDocumentOrigin).toHaveBeenCalledWith("sample");
  });

  it("uploads selected JSON scripts from the cloud library", async () => {
    authState.user = {
      id: "user-1",
      email: "owner@example.com",
    };
    openJsonDocuments.mockResolvedValue([
      {
        fileName: "Uploaded.json",
        text: "{}",
        handle: null,
      },
    ]);
    listUserScripts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "cloud-1",
          name: "Uploaded.json",
          sizeBytes: 2,
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
      ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("menu-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("My Scripts"));

    await waitFor(() => {
      expect(listUserScripts).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText("Upload JSON"));

    await waitFor(() => {
      expect(openJsonDocuments).toHaveBeenCalledWith({ multiple: true });
      expect(createUserScript).toHaveBeenCalledWith("Uploaded.json", "{}", 2);
    });

    expect(
      screen.getByText("Uploaded 1 script to your cloud library."),
    ).toBeInTheDocument();
    expect(screen.getByText("Uploaded.json")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting a cloud script", async () => {
    authState.user = {
      id: "user-1",
      email: "owner@example.com",
    };
    listUserScripts.mockResolvedValue([
      {
        id: "cloud-1",
        name: "Uploaded.json",
        sizeBytes: 2,
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
      },
    ]);
    vi.mocked(global.confirm).mockReturnValueOnce(false);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("menu-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("My Scripts"));

    await waitFor(() => {
      expect(screen.getByText("Uploaded.json")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Delete"));

    expect(global.confirm).toHaveBeenCalledWith('Delete "Uploaded.json" from My Scripts?');
    expect(deleteUserScript).not.toHaveBeenCalled();
  });
});
