import { describe, expect, it } from "vitest";
import { useEditorStore } from "./editor-store";

describe("editor store", () => {
  it("moves nodes into a child branch while preserving order", () => {
    useEditorStore.getState().loadDocument({
      name: "move-fixture",
      actions: [
        { id: "COMMENT", properties: { Comment: "A" } },
        { id: "ELSE_BRANCH" },
      ],
      customActions: {},
    });

    const [firstNodeId, secondNodeId] = useEditorStore.getState().rootActionIds;
    useEditorStore.getState().moveNode(firstNodeId, secondNodeId, "inside");

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0].id).toBe("ELSE_BRANCH");
    expect(saved.actions[0].children?.[0].properties).toEqual({ Comment: "A" });
  });

  it("updates subtree ownership when moving nodes into a custom action", () => {
    useEditorStore.getState().loadDocument({
      name: "owner-fixture",
      actions: [
        {
          id: "COMMENT",
          properties: { Comment: "root" },
          children: [{ id: "SET_VARIABLE", properties: { "Variable name": "x", Value: "1" } }],
        },
      ],
      customActions: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          actions: [{ id: "COMMENT", properties: { Comment: "target" } }],
        },
      },
    });

    const state = useEditorStore.getState();
    const sourceEditorId = state.rootActionIds[0];
    const targetEditorId = state.customActions.alpha.rootNodeIds[0];

    state.moveNode(sourceEditorId, targetEditorId, "inside");

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions).toHaveLength(0);
    expect(saved.customActions?.alpha.actions[0].children?.[0].id).toBe("COMMENT");
    expect(saved.customActions?.alpha.actions[0].children?.[0].children?.[0].id).toBe(
      "SET_VARIABLE",
    );
  });

  it("preserves raw PSC expressions when updating properties", () => {
    useEditorStore.getState().loadDocument({
      name: "prop-fixture",
      actions: [{ id: "SET_VARIABLE", properties: { Value: "lastOutput()", "Variable name": "x" } }],
      customActions: {},
    });

    const editorId = useEditorStore.getState().rootActionIds[0];
    useEditorStore.getState().updateNodeProperties(editorId, {
      Value: "v(Task)",
      "Variable name": "currentTask",
      Complex: {
        class: "Number",
        value: "1",
      },
    });

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions[0].properties).toEqual({
      Value: "v(Task)",
      "Variable name": "currentTask",
      Complex: {
        class: "Number",
        value: "1",
      },
    });
  });

  it("deletes the selected node subtree", () => {
    useEditorStore.getState().loadDocument({
      name: "delete-fixture",
      actions: [
        {
          id: "IF_VARIABLE_IS",
          children: [
            { id: "SET_VARIABLE", properties: { "Variable name": "x", Value: "1" } },
          ],
        },
        { id: "COMMENT", properties: { Comment: "keep" } },
      ],
      customActions: {},
    });

    const firstNodeId = useEditorStore.getState().rootActionIds[0];
    useEditorStore.getState().removeNode(firstNodeId);

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0].id).toBe("COMMENT");
  });

  it("cuts multiple root nodes in one operation", () => {
    useEditorStore.getState().loadDocument({
      name: "cut-fixture",
      actions: [
        { id: "COMMENT", properties: { Comment: "A" } },
        { id: "COMMENT", properties: { Comment: "B" } },
        { id: "COMMENT", properties: { Comment: "C" } },
      ],
      customActions: {},
    });

    const [firstNodeId, secondNodeId] = useEditorStore.getState().rootActionIds;
    useEditorStore.getState().removeNodes([firstNodeId, secondNodeId]);

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0].properties).toEqual({ Comment: "C" });
  });

  it("undoes the last mutating action", () => {
    useEditorStore.getState().loadDocument({
      name: "undo-fixture",
      actions: [{ id: "COMMENT", properties: { Comment: "first" } }],
      customActions: {},
    });

    const editorId = useEditorStore.getState().rootActionIds[0];
    useEditorStore.getState().updateNodeProperties(editorId, {
      Comment: "changed",
    });
    useEditorStore.getState().undo();

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions[0].properties).toEqual({ Comment: "first" });
  });

  it("inserts multiple node templates in order with one operation", () => {
    useEditorStore.getState().loadDocument({
      name: "paste-fixture",
      actions: [{ id: "COMMENT", properties: { Comment: "anchor" } }],
      customActions: {},
    });

    useEditorStore.getState().insertNodeTemplates(
      [
        { id: "COMMENT", properties: { Comment: "copy-1" } },
        { id: "SET_VARIABLE", properties: { "Variable name": "x", Value: "1" } },
      ],
      null,
      null,
      1,
    );

    const saved = useEditorStore.getState().saveDocument();
    expect(saved.actions.map((node) => node.id)).toEqual([
      "COMMENT",
      "COMMENT",
      "SET_VARIABLE",
    ]);
    expect(saved.actions[1].properties).toEqual({ Comment: "copy-1" });
    expect(saved.actions[2].properties).toEqual({ "Variable name": "x", Value: "1" });
  });

  it("closes active custom action tabs by moving to the first remaining tab", () => {
    useEditorStore.getState().loadDocument({
      name: "tabs-fixture",
      actions: [],
      customActions: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          actions: [{ id: "COMMENT", properties: { Comment: "A" } }],
        },
        beta: {
          id: "beta",
          name: "Beta",
          actions: [{ id: "COMMENT", properties: { Comment: "B" } }],
        },
      },
    });

    useEditorStore.getState().openCustomActionTab("alpha");
    useEditorStore.getState().openCustomActionTab("beta");
    expect(useEditorStore.getState().activeTabId).toBe("customAction:beta");
    expect(useEditorStore.getState().openCustomActionTabIds).toEqual(["alpha", "beta"]);

    useEditorStore.getState().closeCustomActionTab("beta");
    expect(useEditorStore.getState().activeTabId).toBe("customAction:alpha");
    expect(useEditorStore.getState().openCustomActionTabIds).toEqual(["alpha"]);
  });
});
