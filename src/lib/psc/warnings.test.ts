import { describe, expect, it } from "vitest";
import { analyzeDocumentWarnings } from "./warnings";

describe("warning engine", () => {
  it("produces informational warnings without blocking lenient PSC patterns", () => {
    const warnings = analyzeDocumentWarnings({
      name: "warning-fixture",
      actions: [
        {
          id: "IF_VARIABLE_IS",
          properties: {
            "Variable name": "",
            Value: "v(missingVar)",
            Param: "p(customArg)",
          },
        },
        {
          id: "CUSTOM_unknown-action",
          properties: {
            Value: "lastOutput()",
          },
        },
      ],
      customActions: {},
    });

    expect(warnings.some((warning) => warning.message.includes("missingVar"))).toBe(true);
    expect(
      warnings.some((warning) =>
        warning.message.includes("does not match an embedded custom action definition"),
      ),
    ).toBe(true);
    expect(
      warnings.some((warning) =>
        warning.message.includes("parameter syntax was found in the main action tree"),
      ),
    ).toBe(true);
  });

  it("accepts external custom action ids when checking call targets", () => {
    const warnings = analyzeDocumentWarnings(
      {
        name: "local-custom-action-fixture",
        actions: [{ id: "CUSTOM_local-action" }],
        customActions: {},
      },
      {
        "local-action": true,
      },
    );

    expect(
      warnings.some((warning) =>
        warning.message.includes("does not match an embedded custom action definition"),
      ),
    ).toBe(false);
  });
});
