import { describe, expect, it } from "vitest";
import { buildFunctionCatalog } from "./catalog";

describe("PSC function catalog", () => {
  it("builds header sections and nested menu groups from PSC comment nodes", () => {
    const catalog = buildFunctionCatalog({
      name: "PSCFunctions",
      actions: [
        {
          id: "COMMENT",
          properties: {
            Comment: "Script",
          },
          children: [
            {
              id: "COMMENT",
              properties: {
                Comment: "Enable solver",
              },
              children: [
                {
                  id: "ENABLE_LOGIN_SOLVER",
                },
              ],
            },
            {
              id: "STOP_SCRIPT",
            },
          ],
        },
      ],
    });

    expect(catalog.available).toBe(true);
    expect(catalog.sections).toHaveLength(1);
    expect(catalog.sections[0]?.label).toBe("Script");

    const [enableSolverGroup, stopScriptItem] = catalog.sections[0]?.entries ?? [];
    expect(enableSolverGroup?.kind).toBe("group");
    if (enableSolverGroup?.kind === "group") {
      expect(enableSolverGroup.label).toBe("Enable solver");
      expect(enableSolverGroup.entries[0]).toMatchObject({
        kind: "item",
        label: "Enable Login Solver",
      });
    }

    expect(stopScriptItem).toMatchObject({
      kind: "item",
      label: "Stop Script",
    });
  });
});
