export type PscValue =
  | string
  | number
  | boolean
  | null
  | PscValue[]
  | { [key: string]: PscValue | unknown }
  | unknown;

export type PscProperties = Record<string, unknown>;

export type PscNode = {
  id: string;
  properties?: PscProperties;
  children?: PscNode[];
  disabled?: boolean;
  color?: number;
  [key: string]: unknown;
};

export type PscCustomAction = {
  id: string;
  name: string;
  description?: string;
  parameters?: string | object;
  fail?: boolean;
  actions: PscNode[];
  [key: string]: unknown;
};

export type PscImageAsset = string;

export type PscDocument = {
  sleep?: unknown;
  name?: unknown;
  version?: unknown;
  actions: PscNode[];
  customActions?: Record<string, PscCustomAction>;
  images?: Record<string, PscImageAsset>;
  [key: string]: unknown;
};

export type PscWarningSeverity = "info" | "warning";

export type PscWarning = {
  id: string;
  severity: PscWarningSeverity;
  message: string;
  location: string;
};
