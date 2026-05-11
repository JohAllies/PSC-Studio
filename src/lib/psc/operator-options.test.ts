import { describe, expect, it } from "vitest";
import { getOperatorOptions } from "./operator-options";

describe("operator option registry", () => {
  it("returns the seeded operator options", () => {
    const options = getOperatorOptions("EQUALS");
    expect(options.some((option) => option.value === "EQUALS")).toBe(true);
    expect(options.some((option) => option.value === "IS_TRUE")).toBe(true);
  });

  it("keeps unknown current operators selectable", () => {
    const options = getOperatorOptions("CUSTOM_OPERATOR");
    expect(options[0]).toEqual({
      value: "CUSTOM_OPERATOR",
      label: "Custom Operator",
    });
  });
});
