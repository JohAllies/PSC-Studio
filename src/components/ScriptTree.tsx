import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TreeRow } from "./TreeRow";
import {
  type TreeNodeRef,
  selectCurrentCustomAction,
  useEditorStore,
} from "../store/editor-store";
import {
  buildCustomActionCategoryTree,
  parseCustomActionDisplayName,
  type CustomActionCategoryNode,
} from "../lib/psc/custom-action-groups";
import { formatTreeNodeLabel } from "../lib/psc/labels";
import type { EditorNodeEntity } from "../lib/psc/parse";
import type { PscNode } from "../types/psc";

type ScriptTreeProps = {
  getNodeLabel: (editorId: string) => string;
};

type ContextMenuState =
  | {
      kind: "customActions";
      x: number;
      y: number;
      customActionIds: string[];
    }
  | {
      kind: "treeNodes";
      x: number;
      y: number;
      editorIds: string[];
    };

const countCategoryActions = (category: CustomActionCategoryNode): number =>
  category.actions.length +
  category.categories.reduce(
    (total, childCategory) => total + countCategoryActions(childCategory),
    0,
  );

const findCategoryByKey = (
  categories: CustomActionCategoryNode[],
  categoryKey: string,
): CustomActionCategoryNode | null => {
  for (const category of categories) {
    if (category.key === categoryKey) {
      return category;
    }

    const nestedCategory = findCategoryByKey(category.categories, categoryKey);
    if (nestedCategory) {
      return nestedCategory;
    }
  }

  return null;
};

const flattenCategoryRows = (
  category: CustomActionCategoryNode,
  branchSegments: string[] = [],
): Array<
  ReturnType<typeof parseCustomActionDisplayName> & {
    categoryLabel: string;
    relativePath: string;
  }
> => {
  return [
    ...category.actions.map((action) => ({
      ...action,
      categoryLabel: category.label,
      relativePath: branchSegments.join(" > "),
    })),
    ...category.categories.flatMap((childCategory) =>
      flattenCategoryRows(childCategory, [...branchSegments, childCategory.label]),
    ),
  ];
};

const hasSelectedAncestor = (
  editorId: string,
  selectedIds: Set<string>,
  nodeIndex: Record<string, EditorNodeEntity>,
) => {
  let cursor = nodeIndex[editorId]?.parentEditorId ?? null;

  while (cursor) {
    if (selectedIds.has(cursor)) {
      return true;
    }
    cursor = nodeIndex[cursor]?.parentEditorId ?? null;
  }

  return false;
};

const cloneNodeTemplate = (
  editorId: string,
  nodeIndex: Record<string, EditorNodeEntity>,
): PscNode => {
  const entity = nodeIndex[editorId];
  const node = JSON.parse(JSON.stringify(entity.raw)) as PscNode;

  if (entity.childIds.length > 0) {
    node.children = entity.childIds.map((childId) => cloneNodeTemplate(childId, nodeIndex));
  }

  return node;
};

const copyTextToClipboard = async (text: string) => {
  if (!navigator.clipboard?.writeText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ignore clipboard permission failures and keep the in-app copy buffer.
  }
};

export const ScriptTree = ({ getNodeLabel }: ScriptTreeProps) => {
  const uncategorizedRootKey = "__uncategorized__";
  const directActionsKey = "__direct_actions__";
  const sectionRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const openCustomActionTabIds = useEditorStore((state) => state.openCustomActionTabIds);
  const nodeIndex = useEditorStore((state) => state.nodeIndex);
  const selection = useEditorStore((state) => state.selection);
  const collapsedNodeIds = useEditorStore((state) => state.collapsedNodeIds);
  const customActions = useEditorStore((state) => state.customActions);
  const rootActionIds = useEditorStore((state) => state.rootActionIds);
  const selectNode = useEditorStore((state) => state.selectNode);
  const selectCustomAction = useEditorStore((state) => state.selectCustomAction);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const openCustomActionTab = useEditorStore((state) => state.openCustomActionTab);
  const closeCustomActionTab = useEditorStore((state) => state.closeCustomActionTab);
  const toggleNodeCollapsed = useEditorStore((state) => state.toggleNodeCollapsed);
  const moveNode = useEditorStore((state) => state.moveNode);
  const insertNodeTemplates = useEditorStore((state) => state.insertNodeTemplates);
  const removeNodes = useEditorStore((state) => state.removeNodes);
  const currentCustomAction = useEditorStore(selectCurrentCustomAction);
  const copiedNodeTemplatesRef = useRef<PscNode[]>([]);
  const [selectedTreeNodeIds, setSelectedTreeNodeIds] = useState<string[]>([]);
  const [lastSelectedTreeNodeId, setLastSelectedTreeNodeId] = useState<string | null>(null);
  const [selectedCustomActionIds, setSelectedCustomActionIds] = useState<string[]>([]);
  const [lastSelectedCustomActionId, setLastSelectedCustomActionId] = useState<string | null>(null);
  const [selectedCustomActionRootKey, setSelectedCustomActionRootKey] = useState<string>("");
  const [selectedCustomActionSubcategoryKey, setSelectedCustomActionSubcategoryKey] =
    useState<string>("");
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);

  const customActionTree = useMemo(
    () =>
      buildCustomActionCategoryTree(
        Object.values(customActions).map((customAction) => ({
          customActionId: customAction.customActionId,
          name: customAction.raw.name,
        })),
      ),
    [customActions],
  );

  const openedCustomActionTabs = useMemo(
    () =>
      openCustomActionTabIds
        .map((customActionId) => customActions[customActionId])
        .filter((customAction): customAction is NonNullable<typeof customAction> => Boolean(customAction))
        .map((customAction) => ({
          entity: customAction,
          display: parseCustomActionDisplayName(
            customAction.raw.name,
            customAction.customActionId,
          ),
        })),
    [customActions, openCustomActionTabIds],
  );

  const visibleNodes = useMemo(() => {
    const collectTree = (ids: string[], depth = 0): TreeNodeRef[] =>
      ids.flatMap((editorId) => {
        const entity = nodeIndex[editorId];
        const current: TreeNodeRef = {
          editorId,
          depth,
          parentEditorId: entity.parentEditorId,
          ownerCustomActionId: entity.ownerCustomActionId,
        };

        if (collapsedNodeIds[editorId]) {
          return [current];
        }

        return [current, ...collectTree(entity.childIds, depth + 1)];
      });

    if (activeTabId === "actions") {
      return collectTree(rootActionIds);
    }

    if (!activeTabId.startsWith("customAction:")) {
      return [];
    }

    const customActionId = activeTabId.slice("customAction:".length);
    if (!customActions[customActionId]) {
      return [];
    }

    return collectTree(customActions[customActionId].rootNodeIds);
  }, [activeTabId, collapsedNodeIds, customActions, nodeIndex, rootActionIds]);

  const rowVirtualizer = useVirtualizer({
    count: visibleNodes.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const selectedNodeLabel =
    selection.kind === "node"
      ? getNodeLabel(selection.editorId)
      : null;

  const visibleNodeIds = useMemo(
    () => visibleNodes.map((item) => item.editorId),
    [visibleNodes],
  );

  useEffect(() => {
    setSelectedTreeNodeIds((currentSelection) =>
      currentSelection.filter((editorId) => visibleNodeIds.includes(editorId)),
    );

    if (lastSelectedTreeNodeId && !visibleNodeIds.includes(lastSelectedTreeNodeId)) {
      setLastSelectedTreeNodeId(null);
    }

    setContextMenuState((currentMenu) =>
      currentMenu && currentMenu.kind === "treeNodes"
        ? (() => {
            const nextIds = currentMenu.editorIds.filter((editorId) =>
              visibleNodeIds.includes(editorId),
            );
            return nextIds.length > 0 ? { ...currentMenu, editorIds: nextIds } : null;
          })()
        : currentMenu,
    );
  }, [lastSelectedTreeNodeId, visibleNodeIds]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) {
      return;
    }

    const [targetEditorId, position] = String(event.over.id).split(":");

    if (
      position !== "before" &&
      position !== "after" &&
      position !== "inside"
    ) {
      return;
    }

    moveNode(String(event.active.id), targetEditorId, position);
  };

  const subtitle =
    activeTabId === "actions"
      ? "Main root actions"
      : activeTabId === "customActions"
        ? "Custom action registry"
        : currentCustomAction
          ? String(currentCustomAction.raw.name)
          : "No custom action selected";

  const customActionRootEntries = useMemo(
    () => [
      ...customActionTree.categories.map((category) => ({
        key: category.key,
        label: category.label,
        count: countCategoryActions(category),
      })),
      ...(customActionTree.actions.length > 0
        ? [
            {
              key: uncategorizedRootKey,
              label: "Uncategorized",
              count: customActionTree.actions.length,
            },
          ]
        : []),
    ],
    [customActionTree.actions.length, customActionTree.categories],
  );

  useEffect(() => {
    if (customActionRootEntries.length === 0) {
      if (selectedCustomActionRootKey !== "") {
        setSelectedCustomActionRootKey("");
      }
      return;
    }

    const stillExists = customActionRootEntries.some(
      (entry) => entry.key === selectedCustomActionRootKey,
    );

    if (!stillExists) {
      setSelectedCustomActionRootKey(customActionRootEntries[0].key);
    }
  }, [customActionRootEntries, selectedCustomActionRootKey]);

  const selectedRootCategory = useMemo(
    () =>
      selectedCustomActionRootKey === uncategorizedRootKey
        ? null
        : customActionTree.categories.find(
            (category) => category.key === selectedCustomActionRootKey,
          ) ?? null,
    [customActionTree.categories, selectedCustomActionRootKey],
  );

  const customActionSubcategoryEntries = useMemo(() => {
    if (!selectedRootCategory) {
      return [];
    }

    return [
      ...selectedRootCategory.categories.map((category) => ({
        key: category.key,
        label: category.label,
        count: countCategoryActions(category),
      })),
      ...(selectedRootCategory.actions.length > 0
        ? [
            {
              key: directActionsKey,
              label: "Direct Actions",
              count: selectedRootCategory.actions.length,
            },
          ]
        : []),
    ];
  }, [selectedRootCategory]);

  const hasNestedSubcategories = Boolean(selectedRootCategory?.categories.length);

  useEffect(() => {
    if (!selectedRootCategory) {
      if (selectedCustomActionSubcategoryKey !== "") {
        setSelectedCustomActionSubcategoryKey("");
      }
      return;
    }

    if (!hasNestedSubcategories) {
      if (selectedCustomActionSubcategoryKey !== directActionsKey) {
        setSelectedCustomActionSubcategoryKey(directActionsKey);
      }
      return;
    }

    if (customActionSubcategoryEntries.length === 0) {
      if (selectedCustomActionSubcategoryKey !== "") {
        setSelectedCustomActionSubcategoryKey("");
      }
      return;
    }

    const stillExists = customActionSubcategoryEntries.some(
      (entry) => entry.key === selectedCustomActionSubcategoryKey,
    );

    if (!stillExists) {
      setSelectedCustomActionSubcategoryKey(customActionSubcategoryEntries[0].key);
    }
  }, [
    customActionSubcategoryEntries,
    directActionsKey,
    hasNestedSubcategories,
    selectedCustomActionSubcategoryKey,
    selectedRootCategory,
  ]);

  useEffect(() => {
    setSelectedCustomActionIds((currentSelection) =>
      currentSelection.filter((customActionId) => Boolean(customActions[customActionId])),
    );
  }, [customActions]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const closeContextMenu = () => setContextMenuState(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenuState(null);
      }
    };

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeContextMenu, true);

    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [contextMenuState]);

  const selectedCustomActionRows = useMemo(() => {
    if (selectedCustomActionRootKey === uncategorizedRootKey) {
      return customActionTree.actions.map((action) => ({
        ...action,
        categoryLabel: "Uncategorized",
        relativePath: "",
      }));
    }

    const selectedRootCategory = customActionTree.categories.find(
      (category) => category.key === selectedCustomActionRootKey,
    );

    if (!selectedRootCategory) {
      return [];
    }

    if (selectedCustomActionSubcategoryKey === directActionsKey) {
      return selectedRootCategory.actions.map((action) => ({
        ...action,
        categoryLabel: selectedRootCategory.label,
        relativePath: "",
      }));
    }

    if (!selectedCustomActionSubcategoryKey) {
      return flattenCategoryRows(selectedRootCategory);
    }

    const selectedSubcategory = findCategoryByKey(
      selectedRootCategory.categories,
      selectedCustomActionSubcategoryKey,
    );

    if (!selectedSubcategory) {
      return flattenCategoryRows(selectedRootCategory);
    }

    return flattenCategoryRows(selectedSubcategory);
  }, [
    customActionTree.actions,
    selectedCustomActionRootKey,
    selectedCustomActionSubcategoryKey,
    selectedRootCategory,
  ]);

  const displayedCustomActionIds = useMemo(
    () => selectedCustomActionRows.map((action) => action.customActionId),
    [selectedCustomActionRows],
  );

  const applyTreeSelection = (
    editorId: string,
    event?: Pick<ReactPointerEvent<HTMLDivElement>, "shiftKey" | "metaKey" | "ctrlKey">,
  ) => {
    const isToggle = Boolean(event?.metaKey || event?.ctrlKey);
    const isRange = Boolean(event?.shiftKey);

    if (isRange && lastSelectedTreeNodeId) {
      const startIndex = visibleNodeIds.indexOf(lastSelectedTreeNodeId);
      const endIndex = visibleNodeIds.indexOf(editorId);

      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        const rangeSelection = visibleNodeIds.slice(from, to + 1);
        setSelectedTreeNodeIds(rangeSelection);
        setLastSelectedTreeNodeId(editorId);
        selectNode(editorId);
        return rangeSelection;
      }
    }

    if (isToggle) {
      const nextSelection = selectedTreeNodeIds.includes(editorId)
        ? selectedTreeNodeIds.filter((selectedId) => selectedId !== editorId)
        : [...selectedTreeNodeIds, editorId];
      const normalizedSelection = nextSelection.length > 0 ? nextSelection : [editorId];
      setSelectedTreeNodeIds(normalizedSelection);
      setLastSelectedTreeNodeId(editorId);
      selectNode(editorId);
      return normalizedSelection;
    }

    setSelectedTreeNodeIds([editorId]);
    setLastSelectedTreeNodeId(editorId);
    selectNode(editorId);
    return [editorId];
  };

  const copySelectedTreeNodes = async (editorIds: string[]) => {
    const selectedSet = new Set(editorIds);
    const topLevelSelectedIds = visibleNodeIds.filter(
      (editorId) =>
        selectedSet.has(editorId) && !hasSelectedAncestor(editorId, selectedSet, nodeIndex),
    );

    const nodeTemplates = topLevelSelectedIds.map((editorId) =>
      cloneNodeTemplate(editorId, nodeIndex),
    );
    copiedNodeTemplatesRef.current = nodeTemplates;
    await copyTextToClipboard(JSON.stringify(nodeTemplates, null, 2));

    return topLevelSelectedIds;
  };

  const cutSelectedTreeNodes = async (editorIds: string[]) => {
    const topLevelSelectedIds = await copySelectedTreeNodes(editorIds);
    if (topLevelSelectedIds.length === 0) {
      return;
    }

    removeNodes(topLevelSelectedIds);
    setSelectedTreeNodeIds([]);
    setLastSelectedTreeNodeId(null);
  };

  const pasteCopiedTreeNodes = () => {
    if (copiedNodeTemplatesRef.current.length === 0) {
      return;
    }

    if (selection.kind === "node") {
      const selectedNode = nodeIndex[selection.editorId];
      if (!selectedNode) {
        return;
      }

      const siblingIds = selectedNode.parentEditorId
        ? nodeIndex[selectedNode.parentEditorId].childIds
        : selectedNode.ownerCustomActionId
          ? customActions[selectedNode.ownerCustomActionId].rootNodeIds
          : rootActionIds;
      const selectedIndex = siblingIds.indexOf(selection.editorId);

      insertNodeTemplates(
        copiedNodeTemplatesRef.current,
        selectedNode.parentEditorId,
        selectedNode.ownerCustomActionId,
        selectedIndex + 1,
      );
      return;
    }

    if (activeTabId.startsWith("customAction:")) {
      insertNodeTemplates(
        copiedNodeTemplatesRef.current,
        null,
        activeTabId.slice("customAction:".length),
      );
      return;
    }

    insertNodeTemplates(copiedNodeTemplatesRef.current, null, null);
  };

  useEffect(() => {
    setSelectedCustomActionIds((currentSelection) =>
      currentSelection.filter((customActionId) => displayedCustomActionIds.includes(customActionId)),
    );

    if (lastSelectedCustomActionId && !displayedCustomActionIds.includes(lastSelectedCustomActionId)) {
      setLastSelectedCustomActionId(null);
    }

    setContextMenuState((currentMenu) =>
      currentMenu
        ? (() => {
            if (currentMenu.kind !== "customActions") {
              return currentMenu;
            }

            const nextIds = currentMenu.customActionIds.filter((customActionId) =>
              displayedCustomActionIds.includes(customActionId),
            );

            return nextIds.length > 0
              ? { ...currentMenu, customActionIds: nextIds }
              : null;
          })()
        : null,
    );
  }, [displayedCustomActionIds, lastSelectedCustomActionId]);

  const applyCustomActionSelection = (
    customActionId: string,
    event?: Pick<ReactMouseEvent<HTMLButtonElement>, "shiftKey" | "metaKey" | "ctrlKey">,
  ) => {
    const isToggle = Boolean(event?.metaKey || event?.ctrlKey);
    const isRange = Boolean(event?.shiftKey);

    if (isRange && lastSelectedCustomActionId) {
      const startIndex = displayedCustomActionIds.indexOf(lastSelectedCustomActionId);
      const endIndex = displayedCustomActionIds.indexOf(customActionId);

      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        const rangeSelection = displayedCustomActionIds.slice(from, to + 1);
        setSelectedCustomActionIds(rangeSelection);
        setLastSelectedCustomActionId(customActionId);
        selectCustomAction(customActionId);
        return rangeSelection;
      }
    }

    if (isToggle) {
      const nextSelection = selectedCustomActionIds.includes(customActionId)
        ? selectedCustomActionIds.filter((selectedId) => selectedId !== customActionId)
        : [...selectedCustomActionIds, customActionId];
      const normalizedSelection = nextSelection.length > 0 ? nextSelection : [customActionId];
      setSelectedCustomActionIds(normalizedSelection);
      setLastSelectedCustomActionId(customActionId);
      selectCustomAction(customActionId);
      return normalizedSelection;
    }

    setSelectedCustomActionIds([customActionId]);
    setLastSelectedCustomActionId(customActionId);
    selectCustomAction(customActionId);
    return [customActionId];
  };

  const handleCustomActionContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    customActionId: string,
  ) => {
    event.preventDefault();
    const nextSelection = selectedCustomActionIds.includes(customActionId)
      ? selectedCustomActionIds
      : applyCustomActionSelection(customActionId);

    setContextMenuState({
      kind: "customActions",
      x: event.clientX,
      y: event.clientY,
      customActionIds: nextSelection,
    });
  };

  const handleTreeNodeContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    editorId: string,
  ) => {
    event.preventDefault();
    const nextSelection = selectedTreeNodeIds.includes(editorId)
      ? selectedTreeNodeIds
      : applyTreeSelection(editorId);

    setContextMenuState({
      kind: "treeNodes",
      x: event.clientX,
      y: event.clientY,
      editorIds: nextSelection,
    });
  };

  const openAllSelectedCustomActionTabs = () => {
    if (!contextMenuState || contextMenuState.kind !== "customActions") {
      return;
    }

    contextMenuState.customActionIds.forEach((customActionId) => openCustomActionTab(customActionId));
    setContextMenuState(null);
  };

  const copySelectedContextNodes = async () => {
    if (!contextMenuState || contextMenuState.kind !== "treeNodes") {
      return;
    }

    await copySelectedTreeNodes(contextMenuState.editorIds);
    setContextMenuState(null);
  };

  const cutSelectedContextNodes = async () => {
    if (!contextMenuState || contextMenuState.kind !== "treeNodes") {
      return;
    }

    await cutSelectedTreeNodes(contextMenuState.editorIds);
    setContextMenuState(null);
  };

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      );
    };

    const isTreeActive = () => {
      const activeElement = document.activeElement;
      return Boolean(
        (sectionRef.current && activeElement instanceof Node && sectionRef.current.contains(activeElement)) ||
          selection.kind === "node" ||
          (activeTabId === "customActions" && selectedCustomActionIds.length > 0),
      );
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "a") {
        if (!isTreeActive()) {
          return;
        }

        event.preventDefault();

        if (activeTabId === "customActions") {
          if (displayedCustomActionIds.length === 0) {
            return;
          }

          setSelectedCustomActionIds(displayedCustomActionIds);
          setLastSelectedCustomActionId(
            displayedCustomActionIds[displayedCustomActionIds.length - 1] ?? null,
          );
          if (displayedCustomActionIds[0]) {
            selectCustomAction(displayedCustomActionIds[0]);
          }
          return;
        }

        if (visibleNodeIds.length === 0) {
          return;
        }

        setSelectedTreeNodeIds(visibleNodeIds);
        setLastSelectedTreeNodeId(visibleNodeIds[visibleNodeIds.length - 1] ?? null);
        selectNode(visibleNodeIds[0]);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (activeTabId === "customActions" || selectedTreeNodeIds.length === 0) {
          return;
        }

        event.preventDefault();
        await copySelectedTreeNodes(selectedTreeNodeIds);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "x") {
        if (activeTabId === "customActions" || selectedTreeNodeIds.length === 0) {
          return;
        }

        event.preventDefault();
        await cutSelectedTreeNodes(selectedTreeNodeIds);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "v") {
        if (activeTabId === "customActions" || copiedNodeTemplatesRef.current.length === 0) {
          return;
        }

        event.preventDefault();
        pasteCopiedTreeNodes();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTabId,
    customActions,
    displayedCustomActionIds,
    insertNodeTemplates,
    nodeIndex,
    removeNodes,
    rootActionIds,
    selectCustomAction,
    selectNode,
    selectedCustomActionIds.length,
    selectedTreeNodeIds,
    selection,
    visibleNodeIds,
  ]);

  return (
    <section className="panel panel--tree" ref={sectionRef} tabIndex={-1}>
      <div className="panel__header">
        <div>
          <div className="panel__title">Script Tree</div>
          <div className="panel__subtitle">{subtitle}</div>
        </div>
        <div className="tree-header__meta">
          {activeTabId === "customActions"
            ? `${Object.keys(customActions).length} custom actions`
            : `${visibleNodes.length} visible lines`}
        </div>
      </div>

      <div className="tree-tabs" role="tablist" aria-label="Tree views">
        <div className="tree-tabs__list">
          <button
            className="tree-tabs__trigger"
            data-state={activeTabId === "actions" ? "active" : "inactive"}
            type="button"
            onClick={() => setActiveTab("actions")}
          >
            Main Actions
          </button>
          <button
            className="tree-tabs__trigger"
            data-state={activeTabId === "customActions" ? "active" : "inactive"}
            type="button"
            onClick={() => setActiveTab("customActions")}
          >
            Custom Actions
          </button>

          {openedCustomActionTabs.length > 0 ? (
            <span className="tree-tabs__separator" aria-hidden="true" />
          ) : null}

          {openedCustomActionTabs.map(({ entity, display }) => {
            const tabId = `customAction:${entity.customActionId}` as const;
            return (
              <button
                key={entity.customActionId}
                className="tree-tabs__trigger tree-tabs__trigger--closable"
                data-state={activeTabId === tabId ? "active" : "inactive"}
                type="button"
                onClick={() => setActiveTab(tabId)}
                title={display.fullLabel}
              >
                <span className="tree-tabs__label">{display.leafLabel}</span>
                <span
                  className="tree-tabs__close"
                  role="button"
                  aria-label={`Close ${display.fullLabel}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeCustomActionTab(entity.customActionId);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTabId === "customActions" ? (
        <div
          className={`custom-action-browser${
            selectedRootCategory && !hasNestedSubcategories
              ? " custom-action-browser--single-sidebar"
              : ""
          }`}
        >
          <aside className="custom-action-browser__sidebar">
            {customActionRootEntries.map((entry) => (
              <button
                key={entry.key}
                className={`custom-action-browser__root${
                  selectedCustomActionRootKey === entry.key
                    ? " custom-action-browser__root--active"
                    : ""
                }`}
                onClick={() => setSelectedCustomActionRootKey(entry.key)}
              >
                <span>{entry.label}</span>
                <span className="custom-action-list__meta">{entry.count}</span>
              </button>
            ))}
          </aside>

          {selectedRootCategory && hasNestedSubcategories ? (
            <aside className="custom-action-browser__sidebar custom-action-browser__sidebar--subcategories">
              {customActionSubcategoryEntries.length > 0 ? (
                customActionSubcategoryEntries.map((entry) => (
                  <button
                    key={entry.key}
                    className={`custom-action-browser__root${
                      selectedCustomActionSubcategoryKey === entry.key
                        ? " custom-action-browser__root--active"
                        : ""
                    }`}
                    onClick={() => setSelectedCustomActionSubcategoryKey(entry.key)}
                  >
                    <span>{entry.label}</span>
                    <span className="custom-action-list__meta">{entry.count}</span>
                  </button>
                ))
              ) : (
                <div className="custom-action-browser__empty">Select a root category</div>
              )}
            </aside>
          ) : null}

          <div className="custom-action-browser__content">
            <div className="custom-action-browser__header">
              <div className="custom-action-browser__title">
                {(hasNestedSubcategories
                  ? customActionSubcategoryEntries.find(
                      (entry) => entry.key === selectedCustomActionSubcategoryKey,
                    )?.label
                  : null) ??
                  customActionRootEntries.find(
                    (entry) => entry.key === selectedCustomActionRootKey,
                  )?.label ??
                  "No category"}
              </div>
              <div className="custom-action-list__meta">
                {selectedCustomActionRows.length} actions
              </div>
            </div>

            <div className="custom-action-table">
              <div className="custom-action-table__head">
                <span>Action</span>
                <span>Path</span>
                <span>Roots</span>
              </div>

              <div className="custom-action-table__body">
                {selectedCustomActionRows.map((action) => {
                  const entity = customActions[action.customActionId];
                  if (!entity) {
                    return null;
                  }

                  return (
                    <button
                      key={action.customActionId}
                      className={`custom-action-table__row${
                        selectedCustomActionIds.includes(action.customActionId)
                          ? " custom-action-table__row--selected"
                          : ""
                      }`}
                      onClick={(event) => {
                        applyCustomActionSelection(action.customActionId, event);
                        setContextMenuState(null);
                      }}
                      onDoubleClick={() => openCustomActionTab(action.customActionId)}
                      onContextMenu={(event) =>
                        handleCustomActionContextMenu(event, action.customActionId)
                      }
                      title={action.fullLabel}
                    >
                      <span>{action.leafLabel}</span>
                      <span>{action.relativePath || action.categoryLabel}</span>
                      <span>{entity.rootNodeIds.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contextMenuState ? (
        <div
          className="context-menu"
          style={{ left: `${contextMenuState.x}px`, top: `${contextMenuState.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenuState.kind === "customActions" ? (
            <button className="context-menu__item" onClick={openAllSelectedCustomActionTabs}>
              {contextMenuState.customActionIds.length > 1
                ? "Open selected actions"
                : "Open custom action"}
            </button>
          ) : (
            <>
              <button className="context-menu__item" onClick={copySelectedContextNodes}>
                {contextMenuState.editorIds.length > 1 ? "Copy multiple" : "Copy"}
              </button>
              <button className="context-menu__item" onClick={cutSelectedContextNodes}>
                {contextMenuState.editorIds.length > 1 ? "Cut multiple" : "Cut"}
              </button>
            </>
          )}
        </div>
      ) : null}

      {activeTabId === "customActions" ? null : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="tree-viewport" ref={containerRef}>
            <div
              className="tree-viewport__inner"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = visibleNodes[virtualRow.index];
                const node = nodeIndex[item.editorId];
                const label = getNodeLabel(item.editorId);
                const dragHint =
                  node.raw.id === "COMMENT"
                    ? undefined
                    : formatTreeNodeLabel(node, customActions) !== label
                      ? formatTreeNodeLabel(node, customActions)
                      : undefined;
                const customActionTargetId =
                  typeof node.raw.id === "string" && node.raw.id.startsWith("CUSTOM_")
                    ? node.raw.id.slice("CUSTOM_".length)
                    : null;

                return (
                  <div
                    key={item.editorId}
                    className="tree-virtual-row"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <TreeRow
                      editorId={item.editorId}
                      node={node}
                      depth={item.depth}
                      selected={selectedTreeNodeIds.includes(item.editorId)}
                      collapsed={Boolean(collapsedNodeIds[item.editorId])}
                      label={label}
                      dragHint={dragHint}
                      isCustomActionNode={Boolean(customActionTargetId)}
                      onSelect={(event) => {
                        if (event.button === 2) {
                          return;
                        }
                        applyTreeSelection(item.editorId, event);
                        setContextMenuState(null);
                      }}
                      onToggle={() => toggleNodeCollapsed(item.editorId)}
                      onDoubleClick={
                        customActionTargetId && customActions[customActionTargetId]
                          ? () => openCustomActionTab(customActionTargetId)
                          : undefined
                      }
                      onContextMenu={(event) => handleTreeNodeContextMenu(event, item.editorId)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <DragOverlay>
            {selectedNodeLabel ? (
              <div className="tree-row tree-row--overlay">{selectedNodeLabel}</div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
};
