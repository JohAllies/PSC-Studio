import Dexie, { type EntityTable } from "dexie";

export type AutosaveRecord = {
  id: string;
  sourceName: string;
  text: string;
  updatedAt: string;
};

class PscStudioDatabase extends Dexie {
  autosaves!: EntityTable<AutosaveRecord, "id">;

  constructor() {
    super("psc-studio");
    this.version(1).stores({
      autosaves: "id, updatedAt",
    });
  }
}

const db = new PscStudioDatabase();

export const loadAutosave = () => db.autosaves.get("active");

export const storeAutosave = async (sourceName: string, text: string) => {
  await db.autosaves.put({
    id: "active",
    sourceName,
    text,
    updatedAt: new Date().toISOString(),
  });
};
