import { getSupabaseClient } from "./client";
import type { CloudScriptDocument, CloudScriptSummary } from "./types";

const SCRIPT_BUCKET = "psc-scripts";
export const CLOUD_STORAGE_QUOTA_BYTES = 25 * 1024 * 1024;

type UserScriptRow = {
  id: string;
  user_id: string;
  name: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
};

const mapScriptSummary = (row: UserScriptRow): CloudScriptSummary => ({
  id: row.id,
  name: row.name,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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

const listUserScriptRows = async (): Promise<UserScriptRow[]> => {
  const client = getRequiredClient();
  const userId = await getRequiredUserId();
  const { data, error } = await client
    .from("user_scripts")
    .select("id,user_id,name,storage_path,size_bytes,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as UserScriptRow[];
};

const getUserScriptRow = async (scriptId: string): Promise<UserScriptRow> => {
  const client = getRequiredClient();
  const userId = await getRequiredUserId();
  const { data, error } = await client
    .from("user_scripts")
    .select("id,user_id,name,storage_path,size_bytes,created_at,updated_at")
    .eq("id", scriptId)
    .eq("user_id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data as UserScriptRow;
};

export const getJsonSizeBytes = (jsonText: string) => new TextEncoder().encode(jsonText).length;

export const getUserStorageUsage = async () => {
  const rows = await listUserScriptRows();
  return rows.reduce((total, row) => total + row.size_bytes, 0);
};

export const listUserScripts = async (): Promise<CloudScriptSummary[]> => {
  const rows = await listUserScriptRows();
  return rows.map(mapScriptSummary);
};

export const getUserScript = async (scriptId: string): Promise<CloudScriptDocument> => {
  const client = getRequiredClient();
  const row = await getUserScriptRow(scriptId);
  const { data, error } = await client.storage.from(SCRIPT_BUCKET).download(row.storage_path);

  if (error) {
    throw error;
  }

  return {
    ...mapScriptSummary(row),
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
  const storagePath = `${userId}/${scriptId}.json`;
  const timestamp = new Date().toISOString();
  const payload = new Blob([jsonText], { type: "application/json" });

  const { error: uploadError } = await client.storage.from(SCRIPT_BUCKET).upload(storagePath, payload, {
    contentType: "application/json",
    upsert: false,
  });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await client
    .from("user_scripts")
    .insert({
      id: scriptId,
      user_id: userId,
      name,
      storage_path: storagePath,
      size_bytes: sizeBytes,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id,user_id,name,storage_path,size_bytes,created_at,updated_at")
    .single();

  if (error) {
    throw error;
  }

  return mapScriptSummary(data as UserScriptRow);
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
  const currentRow = await getUserScriptRow(scriptId);

  if (expectedUpdatedAt && currentRow.updated_at !== expectedUpdatedAt) {
    throw new CloudScriptConflictError(mapScriptSummary(currentRow));
  }

  const usage = await getUserStorageUsage();
  const nextUsage = usage - currentRow.size_bytes + sizeBytes;

  if (nextUsage > CLOUD_STORAGE_QUOTA_BYTES) {
    throw new Error("Saving this script would exceed the 25MB cloud storage limit.");
  }

  const timestamp = new Date().toISOString();
  const payload = new Blob([jsonText], { type: "application/json" });

  const { error: uploadError } = await client
    .storage
    .from(SCRIPT_BUCKET)
    .upload(currentRow.storage_path, payload, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await client
    .from("user_scripts")
    .update({
      name: currentRow.name,
      size_bytes: sizeBytes,
      updated_at: timestamp,
    })
    .eq("id", scriptId)
    .select("id,user_id,name,storage_path,size_bytes,created_at,updated_at")
    .single();

  if (error) {
    throw error;
  }

  return mapScriptSummary(data as UserScriptRow);
};

export const renameUserScript = async (scriptId: string, name: string): Promise<CloudScriptSummary> => {
  const client = getRequiredClient();
  const timestamp = new Date().toISOString();
  const { data, error } = await client
    .from("user_scripts")
    .update({
      name,
      updated_at: timestamp,
    })
    .eq("id", scriptId)
    .select("id,user_id,name,storage_path,size_bytes,created_at,updated_at")
    .single();

  if (error) {
    throw error;
  }

  return mapScriptSummary(data as UserScriptRow);
};

export const deleteUserScript = async (scriptId: string) => {
  const client = getRequiredClient();
  const currentRow = await getUserScriptRow(scriptId);
  const { error: storageError } = await client.storage.from(SCRIPT_BUCKET).remove([currentRow.storage_path]);
  if (storageError) {
    throw storageError;
  }

  const { error } = await client
    .from("user_scripts")
    .delete()
    .eq("id", scriptId);

  if (error) {
    throw error;
  }
};
