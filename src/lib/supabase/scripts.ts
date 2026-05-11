import { getSupabaseClient } from "./client";
import type { CloudScriptDocument, CloudScriptSummary } from "./types";

const SCRIPT_BUCKET = "user_scripts";
export const CLOUD_STORAGE_QUOTA_BYTES = 25 * 1024 * 1024;

type StorageScriptObject = {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: {
    size?: number;
  } | null;
};

const normalizeScriptName = (name: string) => {
  const trimmed = name.trim();
  const withFallback = trimmed.length > 0 ? trimmed : "psc-script.json";
  return withFallback.toLowerCase().endsWith(".json") ? withFallback : `${withFallback}.json`;
};

const sanitizeStorageName = (name: string) =>
  normalizeScriptName(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");

const buildStoragePath = (userId: string, scriptId: string, name: string) =>
  `${userId}/${scriptId}__${sanitizeStorageName(name)}`;

const parseStoragePath = (scriptPath: string) => {
  const [userId, fileName] = scriptPath.split("/", 2);
  if (!userId || !fileName) {
    throw new Error("Invalid cloud script path.");
  }

  return {
    userId,
    fileName,
  };
};

const getScriptDisplayName = (fileName: string) => {
  const parts = fileName.split("__");
  if (parts.length >= 2) {
    return parts.slice(1).join("__");
  }

  const uuidPrefixed = fileName.match(/^[0-9a-f-]{36}-(.+)$/i);
  return uuidPrefixed?.[1] ?? fileName;
};

const getRequiredClient = () => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }
  return client;
};

const getRequiredUserId = async () => {
  const client = getRequiredClient();
  const { data, error } = await client.auth.getUser();
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error("You must be signed in to use cloud scripts.");
  }
  return data.user.id;
};

const mapStorageObject = (
  userId: string,
  storageObject: StorageScriptObject,
): CloudScriptSummary => ({
  id: `${userId}/${storageObject.name}`,
  name: getScriptDisplayName(storageObject.name),
  sizeBytes: Number(storageObject.metadata?.size ?? 0),
  createdAt:
    storageObject.created_at ??
    storageObject.updated_at ??
    new Date(0).toISOString(),
  updatedAt:
    storageObject.updated_at ??
    storageObject.created_at ??
    new Date(0).toISOString(),
});

const listUserScriptObjects = async (): Promise<{
  userId: string;
  objects: StorageScriptObject[];
}> => {
  const client = getRequiredClient();
  const userId = await getRequiredUserId();
  const { data, error } = await client.storage.from(SCRIPT_BUCKET).list(userId, {
    limit: 1000,
  });

  if (error) {
    throw error;
  }

  return {
    userId,
    objects: (data ?? []).filter(
      (object) =>
        typeof object.name === "string" && object.name.toLowerCase().endsWith(".json"),
    ) as StorageScriptObject[],
  };
};

const getUserScriptSummaryByPath = async (scriptPath: string): Promise<CloudScriptSummary> => {
  const currentUserId = await getRequiredUserId();
  const { userId, fileName } = parseStoragePath(scriptPath);

  if (currentUserId !== userId) {
    throw new Error("You do not have access to this cloud script.");
  }

  const { objects } = await listUserScriptObjects();
  const storageObject = objects.find((object) => object.name === fileName);

  if (!storageObject) {
    throw new Error("Unable to find that cloud script.");
  }

  return mapStorageObject(userId, storageObject);
};

export const getJsonSizeBytes = (jsonText: string) => new TextEncoder().encode(jsonText).length;

export const getUserStorageUsage = async () => {
  const { objects } = await listUserScriptObjects();
  return objects.reduce((total, object) => total + Number(object.metadata?.size ?? 0), 0);
};

export const listUserScripts = async (): Promise<CloudScriptSummary[]> => {
  const { userId, objects } = await listUserScriptObjects();
  return objects
    .map((object) => mapStorageObject(userId, object))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const getUserScript = async (scriptId: string): Promise<CloudScriptDocument> => {
  const client = getRequiredClient();
  const summary = await getUserScriptSummaryByPath(scriptId);
  const { data, error } = await client.storage.from(SCRIPT_BUCKET).download(scriptId);

  if (error) {
    throw error;
  }

  return {
    ...summary,
    jsonText: await data.text(),
  };
};

export const createUserScript = async (
  name: string,
  jsonText: string,
  sizeBytes = getJsonSizeBytes(jsonText),
): Promise<CloudScriptSummary> => {
  const client = getRequiredClient();
  const userId = await getRequiredUserId();
  const usage = await getUserStorageUsage();

  if (usage + sizeBytes > CLOUD_STORAGE_QUOTA_BYTES) {
    throw new Error("Saving this script would exceed the 25MB cloud storage limit.");
  }

  const scriptId = crypto.randomUUID();
  const normalizedName = normalizeScriptName(name);
  const storagePath = buildStoragePath(userId, scriptId, normalizedName);
  const payload = new Blob([jsonText], { type: "application/json" });

  const { error: uploadError } = await client.storage.from(SCRIPT_BUCKET).upload(storagePath, payload, {
    contentType: "application/json",
    upsert: false,
  });

  if (uploadError) {
    throw uploadError;
  }

  return getUserScriptSummaryByPath(storagePath);
};

export class CloudScriptConflictError extends Error {
  latestSummary: CloudScriptSummary;

  constructor(latestSummary: CloudScriptSummary) {
    super("The cloud copy has changed since you opened it.");
    this.latestSummary = latestSummary;
  }
}

export const updateUserScript = async (
  scriptId: string,
  jsonText: string,
  sizeBytes = getJsonSizeBytes(jsonText),
  expectedUpdatedAt?: string | null,
): Promise<CloudScriptSummary> => {
  const client = getRequiredClient();
  const currentSummary = await getUserScriptSummaryByPath(scriptId);

  if (expectedUpdatedAt && currentSummary.updatedAt !== expectedUpdatedAt) {
    throw new CloudScriptConflictError(currentSummary);
  }

  const usage = await getUserStorageUsage();
  const nextUsage = usage - currentSummary.sizeBytes + sizeBytes;

  if (nextUsage > CLOUD_STORAGE_QUOTA_BYTES) {
    throw new Error("Saving this script would exceed the 25MB cloud storage limit.");
  }

  const payload = new Blob([jsonText], { type: "application/json" });
  const { error: uploadError } = await client
    .storage
    .from(SCRIPT_BUCKET)
    .upload(scriptId, payload, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  return getUserScriptSummaryByPath(scriptId);
};

export const renameUserScript = async (scriptId: string, name: string): Promise<CloudScriptSummary> => {
  const client = getRequiredClient();
  const userId = await getRequiredUserId();
  const nextPath = buildStoragePath(userId, crypto.randomUUID(), name);
  const { error } = await client.storage.from(SCRIPT_BUCKET).move(scriptId, nextPath);

  if (error) {
    throw error;
  }

  return getUserScriptSummaryByPath(nextPath);
};

export const deleteUserScript = async (scriptId: string) => {
  const client = getRequiredClient();
  const { error } = await client.storage.from(SCRIPT_BUCKET).remove([scriptId]);

  if (error) {
    throw error;
  }
};
