import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { EditorNodeEntity } from "../lib/psc/parse";
import { nodeCommentColor } from "../lib/psc/labels";

type TreeRowProps = {
  editorId: string;
  node: EditorNodeEntity;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  label: string;
  dragHint?: string;
  isCustomActionNode?: boolean;
  onSelect: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

const DropZone = ({
  id,
  className,
  label,
}: {
  id: string;
  className: string;
  label?: string;
}) => {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className}${isOver ? ` ${className}--active` : ""}`}
    >
      {isOver && label ? <span className="tree-row-zone__label">{label}</span> : null}
    </div>
  );
};

export const TreeRow = ({
  editorId,
  node,
  depth,
  selected,
  collapsed,
  label,
  dragHint,
  isCustomActionNode,
  onSelect,
  onToggle,
  onDoubleClick,
  onContextMenu,
}: TreeRowProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: editorId,
  });
  const commentColor = node.raw.id === "COMMENT" ? nodeCommentColor(node) : null;
  const commentText =
    node.raw.properties &&
    typeof node.raw.properties === "object" &&
    !Array.isArray(node.raw.properties)
      ? (node.raw.properties as Record<string, unknown>).Comment
      : null;
  const isPaintRootBreak = depth === 0 && node.raw.id === "COMMENT" && commentText === "Paint";

  return (
    <div className="tree-row-wrap">
      <DropZone
        id={`${editorId}:before`}
        className="tree-row-zone tree-row-zone--before"
      />
      <DropZone
        id={`${editorId}:inside`}
        className="tree-row-zone tree-row-zone--inside"
      />
      <DropZone
        id={`${editorId}:after`}
        className="tree-row-zone tree-row-zone--after"
      />

      <div
        ref={setNodeRef}
        className={`tree-row${depth === 0 ? " tree-row--root" : ""}${selected ? " tree-row--selected" : ""}${isDragging ? " tree-row--dragging" : ""}`}
        style={{
          transform: CSS.Translate.toString(transform),
        }}
        onPointerDownCapture={onSelect}
        onDoubleClick={() => onDoubleClick?.()}
        onContextMenu={onContextMenu}
        {...attributes}
        {...listeners}
      >
        <div
          className="tree-row__indent"
          aria-hidden="true"
          style={
            {
              width: `${10 + depth * 14}px`,
              "--tree-branch-x": `${18 + Math.max(depth - 1, 0) * 14}px`,
            } as CSSProperties
          }
        >
          <span
            className={`tree-row__branch${
              depth > 0 && node.childIds.length > 0 ? " tree-row__branch--elbow" : ""
            }${isPaintRootBreak ? " tree-row__branch--break-top" : ""}`}
          />
        </div>

        <button
          className="tree-row__toggle"
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          disabled={node.childIds.length === 0}
        >
          {node.childIds.length === 0 ? "" : collapsed ? "+" : "-"}
        </button>

        <div className="tree-row__content">
          <span
            className={`tree-row__icon-slot${isCustomActionNode ? " tree-row__icon-slot--custom" : ""}`}
            aria-hidden="true"
          >
            {isCustomActionNode ? (
              <span className="tree-row__custom-icon">
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : null}
          </span>
          <span
            className={`tree-row__label${isCustomActionNode ? " tree-row__label--custom" : " tree-row__label--plain"}`}
            style={commentColor ? { color: commentColor } : undefined}
          >
            {label}
          </span>
          {node.raw.disabled ? <span className="tree-row__badge">disabled</span> : null}
          {dragHint ? (
            <span className="tree-row__meta tree-row__meta--hint">{dragHint}</span>
          ) : node.childIds.length > 0 ? (
            <span className="tree-row__meta">{node.childIds.length} children</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
