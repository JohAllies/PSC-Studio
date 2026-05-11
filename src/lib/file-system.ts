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

export const openJsonDocument = async (): Promise<LoadedFile | null> => {
  if (supportsNativeFileAccess()) {
    const [handle] = await pickerWindow.showOpenFilePicker?.(jsonPickerOptions) ?? [];

    if (!handle) {
      return null;
    }

    const file = await handle.getFile();
    return {
      fileName: file.name,
      text: await file.text(),
      handle,
    };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      resolve({
        fileName: file.name,
        text: await file.text(),
        handle: null,
      });
    };
    input.click();
  });
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
