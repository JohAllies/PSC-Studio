import { describe, expect, it } from "vitest";
import { getTypeOptionConfigForTarget, getTypeOptionsForTarget } from "./type-option-registry";

describe("type option registry", () => {
  it("returns configured options for a target", () => {
    const options = getTypeOptionsForTarget(
      {
        foo: [
          { value: "NPC", label: "NPC", hasOperator: true, defaultOperator: "EQUALS" },
          { value: "OBJECT", label: "Object" },
        ],
      },
      "foo",
      "NPC",
    );

    expect(options).toEqual([
      { value: "NPC", label: "NPC", hasOperator: true, defaultOperator: "EQUALS" },
      { value: "OBJECT", label: "Object" },
    ]);
  });

  it("keeps the current type selectable when not yet configured", () => {
    const options = getTypeOptionsForTarget({}, "foo", "playerStatus");
    expect(options[0]).toEqual({
      value: "playerStatus",
      label: "Player Status",
    });
  });

  it("returns metadata for the selected type option", () => {
    const option = getTypeOptionConfigForTarget(
      {
        foo: [
          {
            value: "VISIBLE",
            label: "Visible",
            hasOperator: true,
            defaultOperator: "EQUALS",
            lockOperator: true,
          },
        ],
      },
      "foo",
      "VISIBLE",
    );

    expect(option).toEqual({
      value: "VISIBLE",
      label: "Visible",
      hasOperator: true,
      defaultOperator: "EQUALS",
      lockOperator: true,
    });
  });
});
