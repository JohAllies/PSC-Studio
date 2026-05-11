import { useMemo } from "react";
import { useEditorStore } from "../store/editor-store";

type DocumentOverviewProps = {
  onSelectCustomAction: (customActionId: string) => void;
  onSelectImage: (imageKey: string) => void;
};

export const DocumentOverview = ({
  onSelectCustomAction,
  onSelectImage,
}: DocumentOverviewProps) => {
  const topLevelFields = useEditorStore((state) => state.topLevelFields);
  const rootActionIds = useEditorStore((state) => state.rootActionIds);
  const customActions = useEditorStore((state) => state.customActions);
  const images = useEditorStore((state) => state.images);
  const warnings = useEditorStore((state) => state.warnings);

  const customActionEntries = useMemo(
    () =>
      Object.entries(customActions).sort(([, left], [, right]) =>
        String(left.raw.name ?? "").localeCompare(String(right.raw.name ?? "")),
      ),
    [customActions],
  );

  return (
    <section className="panel panel--overview">
      <div className="panel__header">
        <div>
          <div className="panel__title">Overview</div>
          <div className="panel__subtitle">
            Local-first PSC JSON editing with preserved structure
          </div>
        </div>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <span className="overview-card__label">Document</span>
          <strong>{String(topLevelFields.name ?? "Untitled PSC Script")}</strong>
          <span>Version {String(topLevelFields.version ?? "n/a")}</span>
        </article>
        <article className="overview-card">
          <span className="overview-card__label">Main Actions</span>
          <strong>{rootActionIds.length}</strong>
          <span>Root nodes</span>
        </article>
        <article className="overview-card">
          <span className="overview-card__label">Custom Actions</span>
          <strong>{customActionEntries.length}</strong>
          <span>Embedded modules</span>
        </article>
        <article className="overview-card">
          <span className="overview-card__label">Warnings</span>
          <strong>{warnings.length}</strong>
          <span>Informational only</span>
        </article>
      </div>

      <div className="detail-columns">
        <div className="detail-column">
          <h3>Metadata</h3>
          <dl className="meta-list">
            {Object.entries(topLevelFields).map(([key, value]) => (
              <div key={key} className="meta-list__row">
                <dt>{key}</dt>
                <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="detail-column">
          <h3>Embedded Custom Actions</h3>
          <div className="collection-list">
            {customActionEntries.map(([customActionId, customAction]) => (
              <button
                key={customActionId}
                className="collection-list__item"
                onClick={() => onSelectCustomAction(customActionId)}
              >
                <span>{String(customAction.raw.name)}</span>
                <span className="collection-list__meta">{customAction.rootNodeIds.length} roots</span>
              </button>
            ))}
          </div>
        </div>

        <div className="detail-column">
          <h3>Image Assets</h3>
          <div className="collection-list">
            {Object.keys(images).length === 0 ? (
              <div className="empty-state">No embedded images</div>
            ) : (
              Object.keys(images).map((imageKey) => (
                <button
                  key={imageKey}
                  className="collection-list__item"
                  onClick={() => onSelectImage(imageKey)}
                >
                  <span>{imageKey}</span>
                  <span className="collection-list__meta">
                    {Math.round(images[imageKey].length / 1024)} KB
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
