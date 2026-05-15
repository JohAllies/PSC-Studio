import { describe, expect, it } from "vitest";
import {
  buildEffectiveCustomActionSources,
  loadLocalCustomActionsFromFiles,
} from "./local-custom-actions";
import { parseDocument } from "./parse";

describe("local custom action registry", () => {
  it("loads standalone custom action files and document customActions with last-file precedence", () => {
    const registry = loadLocalCustomActionsFromFiles([
      {
        fileName: "z-override.json",
        relativePath: "folder/z-override.json",
        text: JSON.stringify({
          id: "alpha",
          name: "Combat > Override Alpha",
          actions: [{ id: "COMMENT", properties: { Comment: "override" } }],
        }),
        handle: null,
      },
      {
        fileName: "bundle.json",
        relativePath: "folder/bundle.json",
        text: JSON.stringify({
          customActions: {
            alpha: {
              id: "alpha",
              name: "Combat > Embedded Alpha",
              actions: [{ id: "COMMENT", properties: { Comment: "embedded" } }],
            },
            beta: {
              id: "beta",
              name: "Utility > Beta",
              actions: [{ id: "COMMENT", properties: { Comment: "beta" } }],
            },
          },
        }),
        handle: null,
      },
      {
        fileName: "skip.json",
        relativePath: "folder/skip.json",
        text: JSON.stringify({ hello: "world" }),
        handle: null,
      },
    ]);

    expect(Object.keys(registry.customActions)).toEqual(["alpha", "beta"]);
    expect(registry.customActions.alpha.raw.name).toBe("Combat > Override Alpha");
    expect(registry.duplicateIds).toEqual(["alpha"]);
    expect(registry.skippedFiles).toEqual(["folder/skip.json"]);
    expect(registry.sources.alpha.relativePath).toBe("folder/z-override.json");
  });

  it("marks local ids as overriding embedded actions", () => {
    const embedded = parseDocument({
      actions: [],
      customActions: {
        alpha: {
          id: "alpha",
          name: "Embedded Alpha",
          actions: [],
        },
      },
    }).customActions;

    const local = parseDocument({
      actions: [],
      customActions: {
        alpha: {
          id: "alpha",
          name: "Local Alpha",
          actions: [],
        },
        beta: {
          id: "beta",
          name: "Local Beta",
          actions: [],
        },
      },
    }).customActions;

    const sources = buildEffectiveCustomActionSources(embedded, local, {
      alpha: {
        customActionId: "alpha",
        fileName: "alpha.json",
        relativePath: "CustomActions/alpha.json",
        fileHandle: null,
        fileFormat: "standalone",
      },
      beta: {
        customActionId: "beta",
        fileName: "beta.json",
        relativePath: "CustomActions/beta.json",
        fileHandle: null,
        fileFormat: "standalone",
      },
    });

    expect(sources.alpha).toMatchObject({
      source: "local",
      overridesEmbedded: true,
      relativePath: "CustomActions/alpha.json",
    });
    expect(sources.beta).toMatchObject({
      source: "local",
      overridesEmbedded: false,
      relativePath: "CustomActions/beta.json",
    });
  });
});
