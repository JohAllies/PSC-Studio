type StoredDirectoryKind = "scripts" | "customActions";

type DirectoryHandleRecord = {
  id: StoredDirectoryKind;
  handle: FileSystemDirectoryHandle;
  updatedAt: string;
};

type DirectoryHandlePermissionMode = "read" | "readwrite";

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: DirectoryHandlePermissionMode }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: DirectoryHandlePermissionMode }) => Promise<PermissionState>;
};

const DB_NAME = "psc-studio-local-handles";
const STORE_NAME = "directoryHandles";
const DB_VERSION = 1;

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local handle store."));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
) => {
  const db = await openDatabase();

  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);
    let result: T | undefined;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Local handle store request failed."));
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Local handle store transaction failed."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Local handle store transaction aborted."));
    };
  });
};

export const loadStoredDirectoryHandle = async (id: StoredDirectoryKind) => {
  const record = await withStore<DirectoryHandleRecord>("readonly", (store) => store.get(id));
  return record?.handle ?? null;
};

export const storeDirectoryHandle = async (
  id: StoredDirectoryKind,
  handle: FileSystemDirectoryHandle,
) => {
  await withStore("readwrite", (store) =>
    store.put({
      id,
      handle,
      updatedAt: new Date().toISOString(),
    } satisfies DirectoryHandleRecord),
  );
};

export const clearStoredDirectoryHandle = async (id: StoredDirectoryKind) => {
  await withStore("readwrite", (store) => store.delete(id));
};

export const queryDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  mode: DirectoryHandlePermissionMode = "readwrite",
) => {
  const permissionedHandle = handle as PermissionedDirectoryHandle;
  if (!permissionedHandle.queryPermission) {
    return "granted" as PermissionState;
  }

  return permissionedHandle.queryPermission({ mode });
};

export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  mode: DirectoryHandlePermissionMode = "readwrite",
) => {
  const permissionedHandle = handle as PermissionedDirectoryHandle;
  if (!permissionedHandle.requestPermission) {
    return "granted" as PermissionState;
  }

  return permissionedHandle.requestPermission({ mode });
};
