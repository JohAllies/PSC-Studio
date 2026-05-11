export type CustomActionLeaf = {
  customActionId: string;
  fullLabel: string;
  leafLabel: string;
  categoryPath: string[];
};

export type CustomActionCategoryNode = {
  key: string;
  label: string;
  categories: CustomActionCategoryNode[];
  actions: CustomActionLeaf[];
};

type MutableCategoryNode = {
  key: string;
  label: string;
  categoryMap: Map<string, MutableCategoryNode>;
  actions: CustomActionLeaf[];
};

const fallbackLabel = (customActionId: string) => `Custom Action ${customActionId}`;

export const parseCustomActionDisplayName = (
  value: unknown,
  customActionId: string,
): CustomActionLeaf => {
  const rawLabel = typeof value === "string" ? value : "";
  const segments = rawLabel
    .split(">")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    const label = fallbackLabel(customActionId);
    return {
      customActionId,
      fullLabel: label,
      leafLabel: label,
      categoryPath: [],
    };
  }

  const leafLabel = segments[segments.length - 1];
  return {
    customActionId,
    fullLabel: rawLabel.trim(),
    leafLabel,
    categoryPath: segments.slice(0, -1),
  };
};

const sortTree = (node: MutableCategoryNode): CustomActionCategoryNode => ({
  key: node.key,
  label: node.label,
  categories: [...node.categoryMap.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(sortTree),
  actions: [...node.actions].sort((left, right) => left.leafLabel.localeCompare(right.leafLabel)),
});

export const buildCustomActionCategoryTree = (
  entries: Array<{ customActionId: string; name: unknown }>,
): CustomActionCategoryNode => {
  const root: MutableCategoryNode = {
    key: "root",
    label: "root",
    categoryMap: new Map(),
    actions: [],
  };

  entries.forEach(({ customActionId, name }) => {
    const leaf = parseCustomActionDisplayName(name, customActionId);
    let cursor = root;
    const path: string[] = [];

    leaf.categoryPath.forEach((segment) => {
      path.push(segment);
      const key = path.join(">");

      if (!cursor.categoryMap.has(key)) {
        cursor.categoryMap.set(key, {
          key,
          label: segment,
          categoryMap: new Map(),
          actions: [],
        });
      }

      cursor = cursor.categoryMap.get(key)!;
    });

    cursor.actions.push(leaf);
  });

  return sortTree(root);
};
