import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseDocument,
  parseDocumentText,
  serializeDocumentText,
  serializeParsedDocument,
} from "./parse";

describe("PSC parser", () => {
  it("round-trips the large fixture without structural loss", () => {
    const fixtureText = readFileSync(resolve(process.cwd(), "rework_KiwiB.json"), "utf8");
    const fixtureDocument = parseDocumentText(fixtureText);
    const normalized = parseDocument(fixtureDocument);
    const serializedDocument = serializeParsedDocument(normalized);

    expect(serializedDocument).toEqual(fixtureDocument);

    const serializedText = serializeDocumentText(serializedDocument);
    expect(serializedText).toContain("\"SKILL\"");
    expect(serializedText).toContain("\"Skill\"");
    expect(JSON.parse(serializedText)).toEqual(JSON.parse(fixtureText));
  });
});
