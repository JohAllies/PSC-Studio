import { describe, expect, it } from "vitest";
import {
  buildCustomActionCategoryTree,
  parseCustomActionDisplayName,
} from "./custom-action-groups";

describe("custom action grouping", () => {
  it("treats only the last > segment as the action label", () => {
    expect(parseCustomActionDisplayName("Banking > Withdraw > Lobsters", "abc")).toEqual({
      customActionId: "abc",
      fullLabel: "Banking > Withdraw > Lobsters",
      leafLabel: "Lobsters",
      categoryPath: ["Banking", "Withdraw"],
    });
  });

  it("builds nested categories from display names", () => {
    const tree = buildCustomActionCategoryTree([
      { customActionId: "one", name: "Banking > Withdraw > Lobsters" },
      { customActionId: "two", name: "Banking > Deposit > Coins" },
      { customActionId: "three", name: "Combat > Chickens" },
    ]);

    expect(tree.categories.map((category) => category.label)).toEqual(["Banking", "Combat"]);
    expect(tree.categories[0].categories.map((category) => category.label)).toEqual([
      "Deposit",
      "Withdraw",
    ]);
    expect(tree.categories[0].categories[1].actions[0].leafLabel).toBe("Lobsters");
    expect(tree.categories[1].actions[0].leafLabel).toBe("Chickens");
  });
});
