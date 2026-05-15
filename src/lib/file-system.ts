export type LoadedFile = {
  fileName: string;
  text: string;
  handle: FileSystemFileHandle | null;
  relativePath?: string;
};

export type LoadedDirectory = {
  directoryName: string;
  handle: FileSystemDirectoryHandle | null;
  files: LoadedFile[];
};

export type JsonDirectoryTreeNode =
  | {
      kind: "directory";
      name: string;
      path: string;
      children: JsonDirectoryTreeNode[];
    }
  | {
      kind: "file";
      name: string;
      path: string;
      handle: FileSystemFileHandle;
    };

type PickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

type OpenPickerOptions = {
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  types?: PickerAcceptType[];
};

type SavePickerOptions = {
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
  types?: PickerAcceptType[];
};

type DirectoryPickerOptions = {
  mode?: "read" | "readwrite";
};

type PickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (
      options?: OpenPickerOptions,
    ) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (
      options?: SavePickerOptions,
    ) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (
      options?: DirectoryPickerOptions,
    ) => Promise<FileSystemDirectoryHandle>;
  };

const pickerWindow = window as PickerWindow;

const jsonPickerOptions: OpenPickerOptions = {
  excludeAcceptAllOption: false,
  types: [
    {
      description: "JSON",
      accept: {
        "application/json": [".json"],
      },
    },
  ],
};

export const supportsNativeFileAccess = () =>
  typeof pickerWindow.showOpenFilePicker === "function" &&
  typeof pickerWindow.showSaveFilePicker === "function";

export const supportsNativeDirectoryAccess = () =>
  typeof pickerWindow.showDirectoryPicker === "function";

type OpenJsonDocumentsOptions = {
  multiple?: boolean;
};

export const openJsonDocuments = async ({
  multiple = false,
}: OpenJsonDocumentsOptions = {}): Promise<LoadedFile[]> => {
  if (supportsNativeFileAccess()) {
    const handles = await pickerWindow.showOpenFilePicker?.({
      ...jsonPickerOptions,
      multiple,
    }) ?? [];

    return Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        return {
          fileName: file.name,
          text: await file.text(),
          handle,
          relativePath: file.name,
        };
      }),
    );
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.multiple = multiple;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve([]);
        return;
      }

      const loadedFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          text: await file.text(),
          handle: null,
          relativePath: file.name,
        })),
      );

      resolve(loadedFiles);
    };
    input.click();
  });
};

export const openJsonDocument = async (): Promise<LoadedFile | null> => {
  const [file] = await openJsonDocuments();
  return file ?? null;
};

const isJsonLikePath = (value: string) => value.toLowerCase().endsWith(".json");

const sortTreeNodes = (nodes: JsonDirectoryTreeNode[]): JsonDirectoryTreeNode[] =>
  [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

const readJsonDirectoryHandle = async (
  handle: FileSystemDirectoryHandle,
  relativePrefix = "",
): Promise<LoadedFile[]> => {
  const files: LoadedFile[] = [];
  const iterableHandle = handle as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>;
  };

  for await (const entry of iterableHandle.values()) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      files.push(
        ...(await readJsonDirectoryHandle(entry as FileSystemDirectoryHandle, relativePath)),
      );
      continue;
    }

    if (!isJsonLikePath(entry.name)) {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    files.push({
      fileName: file.name,
      text: await file.text(),
      handle: fileHandle,
      relativePath,
    });
  }

  return files;
};

export const readJsonDirectory = async (
  handle: FileSystemDirectoryHandle,
): Promise<LoadedDirectory> => ({
  directoryName: handle.name,
  handle,
  files: await readJsonDirectoryHandle(handle),
});

const readJsonDirectoryTreeHandle = async (
  handle: FileSystemDirectoryHandle,
  relativePrefix = "",
): Promise<JsonDirectoryTreeNode[]> => {
  const iterableHandle = handle as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>;
  };
  const nodes: JsonDirectoryTreeNode[] = [];

  for await (const entry of iterableHandle.values()) {
    const path = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      const children = await readJsonDirectoryTreeHandle(
        entry as FileSystemDirectoryHandle,
        path,
      );
      if (children.length > 0) {
        nodes.push({
          kind: "directory",
          name: entry.name,
          path,
          children: sortTreeNodes(children),
        });
      }
      continue;
    }

    if (!isJsonLikePath(entry.name)) {
      continue;
    }

    nodes.push({
      kind: "file",
      name: entry.name,
      path,
      handle: entry as FileSystemFileHandle,
    });
  }

  return sortTreeNodes(nodes);
};

export const readJsonDirectoryTree = async (
  handle: FileSystemDirectoryHandle,
): Promise<JsonDirectoryTreeNode[]> => readJsonDirectoryTreeHandle(handle);

export const readTextFileHandle = async (handle: FileSystemFileHandle) => {
  const file = await handle.getFile();
  return file.text();
};

export const openJsonDirectory = async (): Promise<LoadedDirectory | null> => {
  if (!supportsNativeDirectoryAccess()) {
    throw new Error(
      "This browser does not support direct local folder access. Use a Chromium-based browser to grant read/write folder access.",
    );
  }

  const handle = await pickerWindow.showDirectoryPicker?.({ mode: "readwrite" });
  if (!handle) {
    return null;
  }

  return readJsonDirectory(handle);
};

const writeToHandle = async (handle: FileSystemFileHandle, text: string) => {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

export const writeTextToFileHandle = async (
  handle: FileSystemFileHandle,
  text: string,
) => {
  await writeToHandle(handle, text);
};

export const writeJsonFileInDirectory = async (
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  text: string,
): Promise<FileSystemFileHandle> => {
  const handle = await directoryHandle.getFileHandle(fileName, { create: true });
  await writeToHandle(handle, text);
  return handle;
};

export const saveJsonDocument = async (
  fileName: string,
  text: string,
  handle: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> => {
  if (handle) {
    await writeToHandle(handle, text);
    return handle;
  }

  if (supportsNativeFileAccess()) {
    const nextHandle = await pickerWindow.showSaveFilePicker?.({
      types: jsonPickerOptions.types,
      excludeAcceptAllOption: jsonPickerOptions.excludeAcceptAllOption,
      suggestedName: fileName,
    });

    if (!nextHandle) {
      return null;
    }

    await writeToHandle(nextHandle, text);
    return nextHandle;
  }

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return null;
};
