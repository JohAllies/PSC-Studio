export type LoadedFile = {
  fileName: string;
  text: string;
  handle: FileSystemFileHandle | null;
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

type PickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (
      options?: OpenPickerOptions,
    ) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (
      options?: SavePickerOptions,
    ) => Promise<FileSystemFileHandle>;
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

const writeToHandle = async (handle: FileSystemFileHandle, text: string) => {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
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
