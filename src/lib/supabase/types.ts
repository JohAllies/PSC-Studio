import type { Session, User } from "@supabase/supabase-js";

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  isConfigured: boolean;
};

export type CloudScriptSummary = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type CloudScriptDocument = CloudScriptSummary & {
  jsonText: string;
};

export type EditorDocumentOrigin = "local" | "cloud" | "sample" | "unsaved";

export type CloudSourceMetadata = {
  cloudScriptId: string;
  cloudRevisionUpdatedAt: string;
  cloudScriptName: string;
};
