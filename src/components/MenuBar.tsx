import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import type {
  PscFunctionMenuEntry,
  PscFunctionMenuSection,
} from "../lib/psc/catalog";
import type { PscNode } from "../types/psc";

type MenuBarProps = {
  sourceName: string;
  hasCatalog: boolean;
  catalogSections: PscFunctionMenuSection[];
  accountEmail: string | null;
  onOpenFile: () => void;
  onSaveFile: () => void;
  onOpenCloudLibrary: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onInsertCatalogNode: (node: PscNode) => void;
};

const fallbackSections = [
  "Editor",
  "Automator",
  "Custom Actions",
  "Script",
  "Logic",
  "Loops",
  "Variables",
  "Entities",
  "Walking",
  "Inventory",
  "Bank",
  "Sleep",
  "Paint",
  "More",
];

const renderMenuEntries = (
  entries: PscFunctionMenuEntry[],
  ownerMenuKey: string,
  onInsertCatalogNode: (node: PscNode) => void,
) =>
  entries.map((entry) => {
    if (entry.kind === "separator") {
      return <DropdownMenu.Separator key={entry.key} className="dropdown-separator" />;
    }

    if (entry.kind === "group") {
      return (
        <DropdownMenu.Sub key={entry.key}>
          <DropdownMenu.SubTrigger
            className="dropdown-sub-trigger"
            data-menu-owner={ownerMenuKey}
          >
            <span>{entry.label}</span>
            <span className="dropdown-chevron">›</span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              className="dropdown-content dropdown-content--submenu"
              sideOffset={4}
              data-menu-owner={ownerMenuKey}
            >
              {renderMenuEntries(entry.entries, ownerMenuKey, onInsertCatalogNode)}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      );
    }

    return (
      <DropdownMenu.Item
        key={entry.key}
        className="dropdown-item"
        onSelect={() => onInsertCatalogNode(entry.node)}
      >
        {entry.label}
      </DropdownMenu.Item>
    );
  });

export const MenuBar = ({
  sourceName,
  hasCatalog,
  catalogSections,
  accountEmail,
  onOpenFile,
  onSaveFile,
  onOpenCloudLibrary,
  onOpenSettings,
  onSignOut,
  onInsertCatalogNode,
}: MenuBarProps) => {
  const [hoveredMenuKey, setHoveredMenuKey] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const triggerNodeMapRef = useRef<Record<string, HTMLButtonElement | null>>({});

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openHoveredMenu = (menuKey: string) => {
    clearCloseTimer();
    setHoveredMenuKey(menuKey);
  };

  const scheduleMenuClose = (menuKey: string) => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setHoveredMenuKey((current) => (current === menuKey ? null : current));
      closeTimerRef.current = null;
    }, 120);
  };

  const setTriggerNode = (menuKey: string, node: HTMLButtonElement | null) => {
    triggerNodeMapRef.current[menuKey] = node;
  };

  useEffect(() => {
    if (!hoveredMenuKey) {
      return;
    }

    const getMenuKeyAtPoint = (clientX: number, clientY: number) => {
      for (const [menuKey, triggerNode] of Object.entries(triggerNodeMapRef.current)) {
        if (!triggerNode) {
          continue;
        }

        const rect = triggerNode.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return menuKey;
        }
      }

      return null;
    };

    const isWithinExpandedBounds = (event: PointerEvent) => {
      const triggerNode = triggerNodeMapRef.current[hoveredMenuKey];
      if (!triggerNode) {
        return false;
      }

      const trackedRects = [
        triggerNode.getBoundingClientRect(),
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-menu-owner="${hoveredMenuKey}"]`,
          ),
        ).map((element) => element.getBoundingClientRect()),
      ];

      const margin = 28;
      const left = Math.min(...trackedRects.map((rect) => rect.left)) - margin;
      const right = Math.max(...trackedRects.map((rect) => rect.right)) + margin;
      const top = Math.min(...trackedRects.map((rect) => rect.top)) - margin;
      const bottom = Math.max(...trackedRects.map((rect) => rect.bottom)) + margin;

      return (
        event.clientX >= left &&
        event.clientX <= right &&
        event.clientY >= top &&
        event.clientY <= bottom
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const hoveredTriggerMenuKey = getMenuKeyAtPoint(event.clientX, event.clientY);

      if (hoveredTriggerMenuKey) {
        if (hoveredTriggerMenuKey !== hoveredMenuKey) {
          openHoveredMenu(hoveredTriggerMenuKey);
        } else {
          clearCloseTimer();
        }
        return;
      }

      if (isWithinExpandedBounds(event)) {
        clearCloseTimer();
        return;
      }

      scheduleMenuClose(hoveredMenuKey);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      clearCloseTimer();
    };
  }, [hoveredMenuKey]);

  return (
    <header className="menu-bar">
      <div className="menu-bar__window-title">PSC Studio - {sourceName}</div>

      <div className="menu-bar__row">
        <nav className="menu-bar__menus" aria-label="Editor sections">
          {catalogSections.length > 0
            ? catalogSections.map((section) => (
                <DropdownMenu.Root
                  key={section.key}
                  open={hoveredMenuKey === section.key}
                  onOpenChange={(open) => {
                    if (open) {
                      openHoveredMenu(section.key);
                      return;
                    }

                    scheduleMenuClose(section.key);
                  }}
                >
                  <div
                    className="menu-bar__menu-wrap"
                    onMouseEnter={() => openHoveredMenu(section.key)}
                    onMouseLeave={() => scheduleMenuClose(section.key)}
                  >
                    <DropdownMenu.Trigger asChild>
                      <button
                        className="menu-bar__menu-item"
                        type="button"
                        ref={(node) => setTriggerNode(section.key, node)}
                        onMouseEnter={() => openHoveredMenu(section.key)}
                        onPointerEnter={() => openHoveredMenu(section.key)}
                      >
                        {section.label}
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="dropdown-content"
                        sideOffset={6}
                        align="start"
                        onMouseEnter={() => openHoveredMenu(section.key)}
                        onMouseLeave={() => scheduleMenuClose(section.key)}
                        onCloseAutoFocus={(event) => event.preventDefault()}
                        data-menu-owner={section.key}
                      >
                        {renderMenuEntries(section.entries, section.key, onInsertCatalogNode)}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </div>
                </DropdownMenu.Root>
              ))
            : fallbackSections.map((section) => (
                <button key={section} className="menu-bar__menu-item" type="button">
                  {section}
                </button>
              ))}
        </nav>

        <div className="menu-bar__actions">
          <button className="app-button app-button--menu" onClick={onOpenFile}>
            Open
          </button>
          <button className="app-button app-button--menu" onClick={onSaveFile}>
            Save
          </button>
          <button className="app-button app-button--menu" onClick={onOpenCloudLibrary}>
            My Scripts
          </button>
          <button className="app-button app-button--menu" onClick={onOpenSettings}>
            Settings
          </button>

          <span className={`pill pill--menu${hasCatalog ? " pill--success" : ""}`}>
            {hasCatalog ? "PSCFunctions loaded" : "Raw mode"}
          </span>
          {accountEmail ? (
            <>
              <span className="pill pill--menu">{accountEmail}</span>
              <button className="app-button app-button--menu" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
};
