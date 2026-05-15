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
import { type TreeNodeRef, useEditorStore } from "../store/editor-store";
import {
  buildCustomActionCategoryTree,
  parseCustomActionDisplayName,
  type CustomActionCategoryNode,
} from "../lib/psc/custom-action-groups";
import { formatTreeNodeLabel } from "../lib/psc/labels";
import type { EffectiveCustomActionSource } from "../lib/psc/local-custom-actions";
import type { EditorCustomActionEntity, EditorNodeEntity } from "../lib/psc/parse";
import type { PscNode } from "../types/psc";

type ScriptTreeProps = {
  customActions: Record<string, EditorCustomActionEntity>;
  customActionSources: Record<string, EffectiveCustomActionSource>;
  localNodeIndex: Record<string, EditorNodeEntity>;
  localLibraryDirectoryName: string | null;
  localLibraryNotice: string | null;
  localLibraryError: string | null;
  localLibraryLoading: boolean;
  canRefreshLocalLibrary: boolean;
  supportsLocalFolderAccess: boolean;
  onChooseLocalLibrary: () => void;
  onRefreshLocalLibrary: () => void;
  onClearLocalLibrary: () => void;
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

export const ScriptTree = ({
  customActions,
  customActionSources,
  localNodeIndex,
  localLibraryDirectoryName,
  localLibraryNotice,
  localLibraryError,
  localLibraryLoading,
  canRefreshLocalLibrary,
  supportsLocalFolderAccess,
  onChooseLocalLibrary,
  onRefreshLocalLibrary,
  onClearLocalLibrary,
}: ScriptTreeProps) => {
  const uncategorizedRootKey = "__uncategorized__";
  const directActionsKey = "__direct_actions__";
  const sectionRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const openCustomActionTabIds = useEditorStore((state) => state.openCustomActionTabIds);
  const nodeIndex = useEditorStore((state) => state.nodeIndex);
  const embeddedCustomActions = useEditorStore((state) => state.customActions);
  const selection = useEditorStore((state) => state.selection);
  const collapsedNodeIds = useEditorStore((state) => state.collapsedNodeIds);
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
  const copiedNodeTemplatesRef = useRef<PscNode[]>([]);
  const [selectedTreeNodeIds, setSelectedTreeNodeIds] = useState<string[]>([]);
  const [lastSelectedTreeNodeId, setLastSelectedTreeNodeId] = useState<string | null>(null);
  const [selectedCustomActionIds, setSelectedCustomActionIds] = useState<string[]>([]);
  const [lastSelectedCustomActionId, setLastSelectedCustomActionId] = useState<string | null>(null);
  const [customActionLibraryView, setCustomActionLibraryView] = useState<"embedded" | "local">(
    "embedded",
  );
  const [selectedCustomActionRootKey, setSelectedCustomActionRootKey] = useState<string>("");
  const [selectedCustomActionSubcategoryKey, setSelectedCustomActionSubcategoryKey] =
    useState<string>("");
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const activeCustomActionId = activeTabId.startsWith("customAction:")
    ? activeTabId.slice("customAction:".length)
    : null;
  const activeCustomActionSource = activeCustomActionId
    ? customActionSources[activeCustomActionId] ?? null
    : null;
  const activeCustomActionNodeIndex =
    activeCustomActionSource?.source === "local" ? localNodeIndex : nodeIndex;
  const isReadOnlyTree = activeCustomActionSource?.source === "local";
  const getNodeLabel = (
    editorId: string,
    sourceNodeIndex: Record<string, EditorNodeEntity> = nodeIndex,
  ) => {
    const node = sourceNodeIndex[editorId];
    return node ? formatTreeNodeLabel(node, customActions) : "";
  };

  const localCustomActions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(customActions).filter(
          ([customActionId]) => customActionSources[customActionId]?.source === "local",
        ),
      ),
    [customActions, customActionSources],
  );

  const visibleCustomActionRegistry =
    customActionLibraryView === "local" ? localCustomActions : embeddedCustomActions;

  const customActionTree = useMemo(
    () =>
      buildCustomActionCategoryTree(
        Object.values(visibleCustomActionRegistry).map((customAction) => ({
          customActionId: customAction.customActionId,
          name: customAction.raw.name,
        })),
      ),
    [visibleCustomActionRegistry],
  );

  const openedCustomActionTabs = useMemo(
    () =>
      openCustomActionTabIds
        .map((customActionId) => customActions[customActionId])
        .filter((customAction): customAction is NonNullable<typeof customAction> => Boolean(customAction))
        .map((customAction) => ({
          entity: customAction,
          source: customActionSources[customAction.customActionId]?.source ?? "embedded",
          display: parseCustomActionDisplayName(
            customAction.raw.name,
            customAction.customActionId,
          ),
        })),
    [customActions, customActionSources, openCustomActionTabIds],
  );

  const visibleNodes = useMemo(() => {
    const collectVisibleTree = (
      ids: string[],
      sourceNodeIndex: Record<string, EditorNodeEntity>,
      depth = 0,
    ): TreeNodeRef[] =>
      ids.flatMap((editorId) => {
        const entity = sourceNodeIndex[editorId];
        if (!entity) {
          return [];
        }
        const current: TreeNodeRef = {
          editorId,
          depth,
          parentEditorId: entity.parentEditorId,
          ownerCustomActionId: entity.ownerCustomActionId,
        };

        if (collapsedNodeIds[editorId]) {
          return [current];
        }

        return [current, ...collectVisibleTree(entity.childIds, sourceNodeIndex, depth + 1)];
      });

    if (activeTabId === "actions") {
      return collectVisibleTree(rootActionIds, nodeIndex);
    }

    if (!activeTabId.startsWith("customAction:")) {
      return [];
    }

    const customActionId = activeTabId.slice("customAction:".length);
    if (!customActions[customActionId]) {
      return [];
    }

    const sourceNodeIndex =
      customActionSources[customActionId]?.source === "local" ? localNodeIndex : nodeIndex;

    return collectVisibleTree(customActions[customActionId].rootNodeIds, sourceNodeIndex);
  }, [
    activeTabId,
    collapsedNodeIds,
    customActions,
    customActionSources,
    localNodeIndex,
    nodeIndex,
    rootActionIds,
  ]);

  const rowVirtualizer = useVirtualizer({
    count: visibleNodes.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  const visibleNodeIndex =
    activeTabId === "actions"
      ? nodeIndex
      : activeCustomActionSource?.source === "local"
        ? localNodeIndex
        : nodeIndex;
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
        : activeCustomActionId && customActions[activeCustomActionId]
          ? String(customActions[activeCustomActionId].raw.name)
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
      currentSelection.filter((customActionId) => Boolean(visibleCustomActionRegistry[customActionId])),
    );
  }, [visibleCustomActionRegistry]);

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
        if (!isReadOnlyTree) {
          selectNode(editorId);
        }
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
      if (!isReadOnlyTree) {
        selectNode(editorId);
      }
      return normalizedSelection;
    }

    setSelectedTreeNodeIds([editorId]);
    setLastSelectedTreeNodeId(editorId);
    if (!isReadOnlyTree) {
      selectNode(editorId);
    }
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
        if (activeTabId === "customActions" || isReadOnlyTree || selectedTreeNodeIds.length === 0) {
          return;
        }

        event.preventDefault();
        await copySelectedTreeNodes(selectedTreeNodeIds);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "x") {
        if (activeTabId === "customActions" || isReadOnlyTree || selectedTreeNodeIds.length === 0) {
          return;
        }

        event.preventDefault();
        await cutSelectedTreeNodes(selectedTreeNodeIds);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "v") {
        if (
          activeTabId === "customActions" ||
          isReadOnlyTree ||
          copiedNodeTemplatesRef.current.length === 0
        ) {
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
        <div className="tree-header__controls">
          {activeTabId === "customActions" ? (
            <>
              <div className="library-view-toggle" role="tablist" aria-label="Custom action source">
                <button
                  className="library-view-toggle__button"
                  data-state={customActionLibraryView === "embedded" ? "active" : "inactive"}
                  onClick={() => setCustomActionLibraryView("embedded")}
                  type="button"
                >
                  Script Baked
                </button>
                <button
                  className="library-view-toggle__button"
                  data-state={customActionLibraryView === "local" ? "active" : "inactive"}
                  onClick={() => setCustomActionLibraryView("local")}
                  type="button"
                >
                  Local Folder
                </button>
              </div>
              <button
                className="app-button app-button--menu"
                onClick={onChooseLocalLibrary}
                disabled={!supportsLocalFolderAccess}
              >
                {localLibraryDirectoryName ? "Regrant Folder Access" : "Grant Folder Access"}
              </button>
              <button
                className="app-button app-button--menu"
                onClick={onRefreshLocalLibrary}
                disabled={
                  !supportsLocalFolderAccess || localLibraryLoading || !localLibraryDirectoryName
                }
              >
                {localLibraryLoading ? "Reading..." : canRefreshLocalLibrary ? "Re-read" : "Re-read"}
              </button>
              <button
                className="app-button app-button--menu app-button--ghost"
                onClick={onClearLocalLibrary}
                disabled={!localLibraryDirectoryName}
              >
                Clear
              </button>
            </>
          ) : null}
          <div className="tree-header__meta">
            {activeTabId === "customActions"
              ? customActionLibraryView === "local"
                ? `${Object.keys(localCustomActions).length} local copies`
                : `${Object.keys(embeddedCustomActions).length} script baked`
              : isReadOnlyTree
                ? `${visibleNodes.length} read-only lines`
                : `${visibleNodes.length} visible lines`}
          </div>
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

          {openedCustomActionTabs.map(({ entity, display, source }) => {
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
                {source === "local" ? (
                  <span className="tree-tabs__badge" title="Local copy">
                    Local
                  </span>
                ) : null}
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
              <div>
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
                {customActionLibraryView === "local" ? (
                  <div className="custom-action-browser__status">
                    {localLibraryDirectoryName
                      ? `Local folder access granted: ${localLibraryDirectoryName}`
                      : supportsLocalFolderAccess
                        ? "Grant folder access to read custom-action files directly from disk."
                        : "Direct local folder access requires a Chromium-based browser."}
                  </div>
                ) : (
                  <div className="custom-action-browser__status">
                    Script-baked custom actions saved inside the loaded PSC document.
                  </div>
                )}
              </div>
              <div className="custom-action-list__meta">
                {selectedCustomActionRows.length} actions
              </div>
            </div>

            {localLibraryNotice ? (
              <div className="custom-action-browser__notice">{localLibraryNotice}</div>
            ) : null}
            {localLibraryError ? (
              <div className="custom-action-browser__error">{localLibraryError}</div>
            ) : null}

            <div className="custom-action-table">
              <div className="custom-action-table__head">
                <span>Action</span>
                <span>Path</span>
                <span>Source</span>
                <span>Roots</span>
              </div>

              <div className="custom-action-table__body">
                {selectedCustomActionRows.length === 0 ? (
                  <div className="custom-action-browser__empty custom-action-browser__empty--table">
                    {customActionLibraryView === "local"
                      ? localLibraryDirectoryName
                        ? "No local custom actions matched this category."
                        : supportsLocalFolderAccess
                          ? "Grant folder access to browse local custom-action files."
                          : "Direct local folder access is unavailable in this browser."
                      : "No script-baked custom actions matched this category."}
                  </div>
                ) : selectedCustomActionRows.map((action) => {
                  const entity = customActions[action.customActionId];
                  const source = customActionSources[action.customActionId];
                  const hasEmbeddedCopy = Boolean(embeddedCustomActions[action.customActionId]);
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
                      <span>
                        {customActionLibraryView === "local"
                          ? hasEmbeddedCopy
                            ? "Local Copy"
                            : "Local Only"
                          : source?.source === "local"
                            ? "Baked, Overridden"
                            : "Script Baked"}
                      </span>
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
          ) : isReadOnlyTree ? (
            <button className="context-menu__item" disabled>
              Local custom actions are read-only
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
        <>
          {isReadOnlyTree ? (
            <div className="tree-help">Local custom action content is read-only.</div>
          ) : null}
          {isReadOnlyTree ? (
            <div className="tree-viewport" ref={containerRef}>
              <div
                className="tree-viewport__inner"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = visibleNodes[virtualRow.index];
                  const node = visibleNodeIndex[item.editorId];
                  if (!node) {
                    return null;
                  }

                  const label = getNodeLabel(item.editorId, visibleNodeIndex);
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
          ) : (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="tree-viewport" ref={containerRef}>
                <div
                  className="tree-viewport__inner"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const item = visibleNodes[virtualRow.index];
                    const node = visibleNodeIndex[item.editorId];
                    if (!node) {
                      return null;
                    }

                    const label = getNodeLabel(item.editorId, visibleNodeIndex);
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
                          onContextMenu={(event) =>
                            handleTreeNodeContextMenu(event, item.editorId)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <DragOverlay
                adjustScale={false}
                dropAnimation={{
                  duration: 90,
                  easing: "cubic-bezier(0.2, 0, 0, 1)",
                }}
              >
                {selectedNodeLabel ? (
                  <div className="tree-row tree-row--overlay">{selectedNodeLabel}</div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </>
      )}
    </section>
  );
};
