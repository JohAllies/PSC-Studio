import { JsonTextarea } from "./JsonTextarea";
import { useEditorStore } from "../store/editor-store";
import { useEffect, useMemo, useState } from "react";
import { getOperatorOptions, OPERATOR_OPTIONS } from "../lib/psc/operator-options";
import {
  getTypeOptionConfigForTarget,
  getTypeOptionsForTarget,
  loadTypeOptionRegistry,
  saveTypeOptionRegistry,
  type TypeOption,
  type TypeOptionRegistry,
} from "../lib/psc/type-option-registry";

const buildImageSrc = (asset: string) =>
  asset.startsWith("data:") ? asset : `data:image/png;base64,${asset}`;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOperatorField = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && "operator" in value;

const hasTypeField = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && "type" in value;

const isStructuredRecord = (value: unknown): value is Record<string, unknown> =>
  hasOperatorField(value) || hasTypeField(value);

const reconcileStructuredTypeValue = (
  currentValue: Record<string, unknown>,
  nextTypeValue: string,
  targetKey: string | undefined,
  typeOptions: TypeOptionRegistry,
): Record<string, unknown> => {
  const nextValue: Record<string, unknown> = {
    ...currentValue,
    type: nextTypeValue,
  };

  if (!targetKey) {
    return nextValue;
  }

  const typeConfig = getTypeOptionConfigForTarget(typeOptions, targetKey, nextTypeValue);

  if (typeConfig?.hasOperator === false) {
    const { operator: _removedOperator, ...rest } = nextValue;
    return rest;
  }

  if (typeConfig?.hasOperator) {
    const fallbackOperator =
      typeConfig.defaultOperator ??
      (typeof currentValue.operator === "string" ? currentValue.operator : null) ??
      "EQUALS";

    return {
      ...nextValue,
      operator: typeConfig.lockOperator ? fallbackOperator : nextValue.operator ?? fallbackOperator,
    };
  }

  return nextValue;
};

const buildDraftId = (...parts: string[]) => parts.join("::");

const useDraftRegistration = (draftId: string, pending: boolean) => {
  const setPendingEdit = useEditorStore((state) => state.setPendingEdit);
  const setInvalidEdit = useEditorStore((state) => state.setInvalidEdit);

  useEffect(() => {
    setPendingEdit(draftId, pending);
    setInvalidEdit(draftId, false);
  }, [draftId, pending, setInvalidEdit, setPendingEdit]);

  useEffect(
    () => () => {
      setPendingEdit(draftId, false);
      setInvalidEdit(draftId, false);
    },
    [draftId, setInvalidEdit, setPendingEdit],
  );
};

const BufferedStringField = ({
  draftId,
  label,
  value,
  onCommit,
}: {
  draftId: string;
  label: string;
  value: string;
  onCommit: (nextValue: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(value);
    }
  }, [isFocused, value]);

  useDraftRegistration(draftId, draft !== value);

  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <label className="field property-row__field">
      <span className="field__label">{label}</span>
      <input
        className="editor-input"
        value={draft}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setIsFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
};

const BufferedNumberField = ({
  draftId,
  label,
  value,
  onCommit,
}: {
  draftId: string;
  label: string;
  value: number;
  onCommit: (nextValue: number) => void;
}) => {
  const committedText = String(value);
  const [draft, setDraft] = useState(committedText);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(committedText);
    }
  }, [committedText, isFocused]);

  useDraftRegistration(draftId, draft !== committedText);

  const commit = () => {
    const trimmed = draft.trim();
    const nextValue = Number(trimmed);

    if (trimmed === "" || Number.isNaN(nextValue)) {
      setDraft(committedText);
      return;
    }

    if (nextValue !== value) {
      onCommit(nextValue);
    }
  };

  return (
    <label className="field property-row__field">
      <span className="field__label">{label}</span>
      <input
        className="editor-input"
        inputMode="decimal"
        value={draft}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setIsFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
};

const BufferedSelectField = ({
  draftId,
  label,
  value,
  options,
  onCommit,
}: {
  draftId: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onCommit: (nextValue: string) => void;
}) => {
  useDraftRegistration(draftId, false);

  return (
    <label className="field property-row__field">
      <span className="field__label">{label}</span>
      <select
        className="editor-input"
        value={value}
        onChange={(event) => onCommit(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

const StructuredObjectEditor = ({
  draftScope,
  typeRegistryKey,
  typeOptions,
  label,
  value,
  onCommit,
  onManageTypeOptions,
}: {
  draftScope: string;
  typeRegistryKey?: string;
  typeOptions: TypeOptionRegistry;
  label: string;
  value: Record<string, unknown>;
  onCommit: (nextValue: Record<string, unknown>) => void;
  onManageTypeOptions?: (targetKey: string, title: string) => void;
}) => {
  const currentTypeValue = typeof value.type === "string" ? value.type : null;
  const currentTypeConfig =
    typeRegistryKey && currentTypeValue
      ? getTypeOptionConfigForTarget(typeOptions, typeRegistryKey, currentTypeValue)
      : null;
  const operatorIsHidden = currentTypeConfig?.hasOperator === false;
  const operatorIsLocked = Boolean(
    currentTypeConfig?.hasOperator && currentTypeConfig.lockOperator && currentTypeConfig.defaultOperator,
  );

  const updateField = (field: string, nextValue: unknown) => {
    if (field === "type" && typeof nextValue === "string") {
      onCommit(reconcileStructuredTypeValue(value, nextValue, typeRegistryKey, typeOptions));
      return;
    }

    onCommit({
      ...value,
      [field]: nextValue,
    });
  };

  return (
    <div className="object-editor">
      <div className="object-editor__header">
        <div className="object-editor__title">{label}</div>
        {typeRegistryKey && hasTypeField(value) ? (
          <button
            className="app-button app-button--ghost object-editor__button"
            onClick={() => onManageTypeOptions?.(typeRegistryKey, label)}
            type="button"
          >
            Type Options
          </button>
        ) : null}
      </div>
      <div className="object-editor__fields">
        {Object.entries(value).map(([field, fieldValue]) => {
          if (field === "operator" && operatorIsHidden) {
            return null;
          }

          if (field === "operator" && typeof fieldValue === "string") {
            return operatorIsLocked ? (
              <label key={field} className="field property-row__field">
                <span className="field__label">{field}</span>
                <div className="editor-input editor-input--static">{fieldValue}</div>
              </label>
            ) : (
              <BufferedSelectField
                key={field}
                draftId={buildDraftId(draftScope, field)}
                label={field}
                value={fieldValue}
                options={getOperatorOptions(fieldValue)}
                onCommit={(nextValue) => updateField(field, nextValue)}
              />
            );
          }

          if (field === "type" && typeof fieldValue === "string" && typeRegistryKey) {
            return (
              <BufferedSelectField
                key={field}
                draftId={buildDraftId(draftScope, field)}
                label={field}
                value={fieldValue}
                options={getTypeOptionsForTarget(typeOptions, typeRegistryKey, fieldValue)}
                onCommit={(nextValue) => updateField(field, nextValue)}
              />
            );
          }

          if (typeof fieldValue === "boolean") {
            return (
              <label key={field} className="field property-row__field">
                <span className="field__label">{field}</span>
                <select
                  className="editor-input"
                  value={fieldValue ? "true" : "false"}
                  onChange={(event) => updateField(field, event.target.value === "true")}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
            );
          }

          if (typeof fieldValue === "number") {
            return (
              <BufferedNumberField
                key={field}
                draftId={buildDraftId(draftScope, field)}
                label={field}
                value={fieldValue}
                onCommit={(nextValue) => updateField(field, nextValue)}
              />
            );
          }

          if (typeof fieldValue === "string") {
            return (
              <BufferedStringField
                key={field}
                draftId={buildDraftId(draftScope, field)}
                label={field}
                value={fieldValue}
                onCommit={(nextValue) => updateField(field, nextValue)}
              />
            );
          }

          return (
            <JsonTextarea
              key={field}
              draftId={buildDraftId(draftScope, field)}
              label={field}
              value={fieldValue}
              onCommit={(nextValue) => updateField(field, nextValue)}
              rows={Array.isArray(fieldValue) ? 6 : 5}
              stringMode={false}
            />
          );
        })}
      </div>
    </div>
  );
};

type PropertyFieldsEditorProps = {
  draftScope: string;
  properties: Record<string, unknown>;
  onChange: (nextProperties: Record<string, unknown>) => void;
  typeOptions: TypeOptionRegistry;
  typeRegistryKeyForProperty: (propertyKey: string) => string;
  onManageTypeOptions: (targetKey: string, title: string) => void;
};

type TemporarySchemaField = {
  id: string;
  name: string;
};

const createTemporarySchemaField = (): TemporarySchemaField => ({
  id: `schema_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: "",
});

const EmptyPropertySchemaBuilder = ({
  onApply,
}: {
  onApply: (nextProperties: Record<string, unknown>) => void;
}) => {
  const [fields, setFields] = useState<TemporarySchemaField[]>([createTemporarySchemaField()]);

  const updateField = (
    fieldId: string,
    updates: Partial<Pick<TemporarySchemaField, "name">>,
  ) => {
    setFields((current) =>
      current.map((field) => (field.id === fieldId ? { ...field, ...updates } : field)),
    );
  };

  const addField = () => {
    setFields((current) => [...current, createTemporarySchemaField()]);
  };

  const removeField = (fieldId: string) => {
    setFields((current) =>
      current.length > 1
        ? current.filter((field) => field.id !== fieldId)
        : [createTemporarySchemaField()],
    );
  };

  const applySchema = () => {
    const nextProperties: Record<string, unknown> = {};

    fields.forEach((field) => {
      const key = field.name.trim();
      if (!key || key in nextProperties) {
        return;
      }

      nextProperties[key] = "";
    });

    if (Object.keys(nextProperties).length === 0) {
      return;
    }

    onApply(nextProperties);
  };

  return (
    <div className="schema-builder">
      <div className="schema-builder__text">
        This node has no properties yet. Add the property names you want to seed, and PSC can treat the values as strings.
      </div>

      <div className="schema-builder__list">
        {fields.map((field) => (
          <div key={field.id} className="schema-builder__row">
            <input
              className="editor-input schema-builder__name"
              placeholder="Property name"
              value={field.name}
              onChange={(event) => updateField(field.id, { name: event.target.value })}
            />
            <button
              className="app-button app-button--ghost schema-builder__remove"
              type="button"
              onClick={() => removeField(field.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="schema-builder__actions">
        <button className="app-button app-button--ghost" type="button" onClick={addField}>
          Add field
        </button>
        <button className="app-button app-button--accent" type="button" onClick={applySchema}>
          Create schema
        </button>
      </div>
    </div>
  );
};

const PropertyValueField = ({
  draftScope,
  typeRegistryKey,
  typeOptions,
  propertyKey,
  value,
  onChange,
  onRemove,
  onManageTypeOptions,
}: {
  draftScope: string;
  typeRegistryKey: string;
  typeOptions: TypeOptionRegistry;
  propertyKey: string;
  value: unknown;
  onChange: (nextValue: unknown) => void;
  onRemove: () => void;
  onManageTypeOptions: (targetKey: string, title: string) => void;
}) => {
  if (typeof value === "boolean") {
    return (
      <div className="property-row">
        <label className="field property-row__field">
          <span className="field__label">{propertyKey}</span>
          <select
            className="editor-input"
            value={value ? "true" : "false"}
            onChange={(event) => onChange(event.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <button className="app-button app-button--ghost property-row__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="property-row">
        <BufferedNumberField
          draftId={buildDraftId(draftScope, propertyKey)}
          label={propertyKey}
          value={value}
          onCommit={onChange}
        />
        <button className="app-button app-button--ghost property-row__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <div className="property-row">
        <BufferedStringField
          draftId={buildDraftId(draftScope, propertyKey)}
          label={propertyKey}
          value={value}
          onCommit={onChange}
        />
        <button className="app-button app-button--ghost property-row__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  if (isStructuredRecord(value)) {
    return (
      <div className="property-row property-row--stacked">
        <StructuredObjectEditor
          draftScope={buildDraftId(draftScope, propertyKey)}
          typeRegistryKey={typeRegistryKey}
          typeOptions={typeOptions}
          label={propertyKey}
          value={value}
          onCommit={onChange}
          onManageTypeOptions={onManageTypeOptions}
        />
        <button className="app-button app-button--ghost property-row__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="property-row property-row--stacked">
      <JsonTextarea
        draftId={buildDraftId(draftScope, propertyKey)}
        label={propertyKey}
        value={value}
        onCommit={onChange}
        rows={Array.isArray(value) ? 6 : 7}
        stringMode={false}
      />
      <button className="app-button app-button--ghost property-row__remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
};

const PropertyFieldsEditor = ({
  draftScope,
  properties,
  onChange,
  typeOptions,
  typeRegistryKeyForProperty,
  onManageTypeOptions,
}: PropertyFieldsEditorProps) => {
  const propertyEntries = useMemo(() => Object.entries(properties), [properties]);

  const updateProperty = (propertyKey: string, nextValue: unknown) => {
    onChange({
      ...properties,
      [propertyKey]: nextValue,
    });
  };

  const removeProperty = (propertyKey: string) => {
    const nextProperties = Object.fromEntries(
      propertyEntries.filter(([currentKey]) => currentKey !== propertyKey),
    );
    onChange(nextProperties);
  };

  return (
    <section className="properties-editor">
      <div className="properties-editor__header">
        <div className="properties-editor__title">Properties</div>
        <div className="properties-editor__meta">{propertyEntries.length} fields</div>
      </div>

      <div className="properties-editor__list">
        {propertyEntries.length === 0 ? (
          <EmptyPropertySchemaBuilder onApply={onChange} />
        ) : (
          propertyEntries.map(([propertyKey, value]) => (
            <PropertyValueField
              key={propertyKey}
              draftScope={draftScope}
              typeRegistryKey={typeRegistryKeyForProperty(propertyKey)}
              typeOptions={typeOptions}
              propertyKey={propertyKey}
              value={value}
              onChange={(nextValue) => updateProperty(propertyKey, nextValue)}
              onRemove={() => removeProperty(propertyKey)}
              onManageTypeOptions={onManageTypeOptions}
            />
          ))
        )}
      </div>
    </section>
  );
};

export const Inspector = () => {
  const selection = useEditorStore((state) => state.selection);
  const nodeIndex = useEditorStore((state) => state.nodeIndex);
  const customActions = useEditorStore((state) => state.customActions);
  const topLevelFields = useEditorStore((state) => state.topLevelFields);
  const images = useEditorStore((state) => state.images);
  const updateNodeProperties = useEditorStore((state) => state.updateNodeProperties);
  const updateNodeRawField = useEditorStore((state) => state.updateNodeRawField);
  const toggleNodeDisabled = useEditorStore((state) => state.toggleNodeDisabled);
  const renameCustomAction = useEditorStore((state) => state.renameCustomAction);
  const updateCustomActionField = useEditorStore((state) => state.updateCustomActionField);
  const updateImageAsset = useEditorStore((state) => state.updateImageAsset);
  const [typeOptionRegistry, setTypeOptionRegistry] = useState<TypeOptionRegistry>(() =>
    loadTypeOptionRegistry(),
  );
  const [typeOptionsDialog, setTypeOptionsDialog] = useState<{
    targetKey: string;
    title: string;
  } | null>(null);
  const [draftTypeOptionValue, setDraftTypeOptionValue] = useState("");
  const [draftTypeOptionLabel, setDraftTypeOptionLabel] = useState("");
  const [draftTypeHasOperator, setDraftTypeHasOperator] = useState(false);
  const [draftTypeDefaultOperator, setDraftTypeDefaultOperator] = useState("EQUALS");
  const [draftTypeLockOperator, setDraftTypeLockOperator] = useState(false);

  const updateTypeOptionRegistry = (updater: (current: TypeOptionRegistry) => TypeOptionRegistry) =>
    setTypeOptionRegistry((current) => {
      const next = updater(current);
      saveTypeOptionRegistry(next);
      return next;
    });

  const openTypeOptionsDialog = (targetKey: string, title: string) => {
    setTypeOptionsDialog({ targetKey, title });
    setDraftTypeOptionValue("");
    setDraftTypeOptionLabel("");
    setDraftTypeHasOperator(false);
    setDraftTypeDefaultOperator("EQUALS");
    setDraftTypeLockOperator(false);
  };

  const closeTypeOptionsDialog = () => {
    setTypeOptionsDialog(null);
    setDraftTypeOptionValue("");
    setDraftTypeOptionLabel("");
    setDraftTypeHasOperator(false);
    setDraftTypeDefaultOperator("EQUALS");
    setDraftTypeLockOperator(false);
  };

  const addTypeOption = () => {
    if (!typeOptionsDialog) {
      return;
    }

    const value = draftTypeOptionValue.trim();
    const label = draftTypeOptionLabel.trim() || value;
    if (!value) {
      return;
    }

    updateTypeOptionRegistry((current) => {
      const nextOptions = current[typeOptionsDialog.targetKey] ?? [];
      const filtered = nextOptions.filter((option) => option.value !== value);
      const nextOption: TypeOption = {
        value,
        label,
      };

      if (draftTypeHasOperator) {
        nextOption.hasOperator = true;
        nextOption.defaultOperator = draftTypeDefaultOperator;
        nextOption.lockOperator = draftTypeLockOperator;
      } else {
        nextOption.hasOperator = false;
        nextOption.defaultOperator = null;
        nextOption.lockOperator = false;
      }

      return {
        ...current,
        [typeOptionsDialog.targetKey]: [...filtered, nextOption],
      };
    });

    setDraftTypeOptionValue("");
    setDraftTypeOptionLabel("");
    setDraftTypeHasOperator(false);
    setDraftTypeDefaultOperator("EQUALS");
    setDraftTypeLockOperator(false);
  };

  const removeTypeOption = (targetKey: string, value: string) => {
    updateTypeOptionRegistry((current) => {
      const nextOptions = (current[targetKey] ?? []).filter((option) => option.value !== value);
      if (nextOptions.length === 0) {
        const { [targetKey]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [targetKey]: nextOptions,
      };
    });
  };

  const renderTypeOptionsDialog = () => {
    if (!typeOptionsDialog) {
      return null;
    }

    const currentOptions = typeOptionRegistry[typeOptionsDialog.targetKey] ?? [];

    return (
      <div className="modal-backdrop" onClick={closeTypeOptionsDialog}>
        <div className="save-dialog type-options-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="save-dialog__title">Type Options</div>
          <div className="save-dialog__text">
            {typeOptionsDialog.title} | {typeOptionsDialog.targetKey}
          </div>

          <div className="type-options-list">
            {currentOptions.length === 0 ? (
              <div className="empty-state">No type options configured for this object yet.</div>
            ) : (
              currentOptions.map((option) => (
                <div key={option.value} className="type-options-list__row">
                  <div className="type-options-list__meta">
                    <strong>{option.label}</strong>
                    <span>{option.value}</span>
                    <span>
                      {option.hasOperator
                        ? option.lockOperator && option.defaultOperator
                          ? `Operator locked to ${option.defaultOperator}`
                          : option.defaultOperator
                            ? `Operator default ${option.defaultOperator}`
                            : "Operator enabled"
                        : "No operator"}
                    </span>
                  </div>
                  <button
                    className="app-button app-button--ghost"
                    onClick={() => removeTypeOption(typeOptionsDialog.targetKey, option.value)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="type-options-form">
            <label className="field">
              <span className="field__label">Value</span>
              <input
                className="editor-input"
                value={draftTypeOptionValue}
                onChange={(event) => setDraftTypeOptionValue(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Label</span>
              <input
                className="editor-input"
                value={draftTypeOptionLabel}
                onChange={(event) => setDraftTypeOptionLabel(event.target.value)}
              />
            </label>
            <label className="field field--checkbox">
              <span className="field__label">Has Operator</span>
              <input
                type="checkbox"
                checked={draftTypeHasOperator}
                onChange={(event) => setDraftTypeHasOperator(event.target.checked)}
              />
            </label>
            <label className="field">
              <span className="field__label">Default Operator</span>
              <select
                className="editor-input"
                value={draftTypeDefaultOperator}
                onChange={(event) => setDraftTypeDefaultOperator(event.target.value)}
                disabled={!draftTypeHasOperator}
              >
                {OPERATOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--checkbox">
              <span className="field__label">Lock Operator</span>
              <input
                type="checkbox"
                checked={draftTypeLockOperator}
                onChange={(event) => setDraftTypeLockOperator(event.target.checked)}
                disabled={!draftTypeHasOperator}
              />
            </label>
          </div>

          <div className="save-dialog__actions">
            <button className="app-button app-button--menu app-button--accent" onClick={addTypeOption}>
              Add Option
            </button>
            <button className="app-button app-button--menu app-button--ghost" onClick={closeTypeOptionsDialog}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (selection.kind === "document") {
    return (
      <>
        <section className="panel panel--inspector">
          <div className="panel__header">
            <div>
              <div className="panel__title">Details</div>
              <div className="panel__subtitle">Select a line in the tree to inspect and edit it</div>
            </div>
          </div>

          <div className="inspector-scroll inspector-scroll--empty">
            <div className="inspector-placeholder">
              <p>Details will appear here when something is selected.</p>
              <dl className="inspector-placeholder__meta">
                {Object.entries(topLevelFields).slice(0, 3).map(([field, value]) => (
                  <div key={field} className="inspector-placeholder__row">
                    <dt>{field}</dt>
                    <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
        {renderTypeOptionsDialog()}
      </>
    );
  }

  if (selection.kind === "node") {
    const node = nodeIndex[selection.editorId];
    const properties = isPlainRecord(node.raw.properties) ? node.raw.properties : {};

    return (
      <>
        <section className="panel panel--inspector">
          <div className="panel__header">
            <div>
              <div className="panel__title">Node Inspector</div>
              <div className="panel__subtitle">
                {String(node.raw.id)} | {node.childIds.length} children
              </div>
            </div>
            <button
              className="app-button app-button--ghost"
              onClick={() => toggleNodeDisabled(node.editorId)}
            >
              {node.raw.disabled ? "Enable" : "Disable"}
            </button>
          </div>

          <div className="inspector-scroll">
            <label className="field">
              <span className="field__label">Node Id</span>
              <div className="editor-input editor-input--static">
                {String(node.raw.id)}
              </div>
            </label>

            <PropertyFieldsEditor
              draftScope={buildDraftId("node-properties", node.editorId)}
              properties={properties}
              onChange={(nextProperties) => updateNodeProperties(node.editorId, nextProperties)}
              typeOptions={typeOptionRegistry}
              typeRegistryKeyForProperty={(propertyKey) =>
                `node:${String(node.raw.id)}:properties:${propertyKey}`
              }
              onManageTypeOptions={openTypeOptionsDialog}
            />

            {Object.entries(node.raw)
              .filter(([field]) => !["id", "properties", "disabled"].includes(field))
              .map(([field, value]) =>
                isStructuredRecord(value) ? (
                  <StructuredObjectEditor
                    key={field}
                    draftScope={buildDraftId("node-raw", node.editorId, field)}
                    typeRegistryKey={`node:${String(node.raw.id)}:field:${field}`}
                    typeOptions={typeOptionRegistry}
                    label={field}
                    value={value}
                    onCommit={(nextValue) => updateNodeRawField(node.editorId, field, nextValue)}
                    onManageTypeOptions={openTypeOptionsDialog}
                  />
                ) : (
                  <JsonTextarea
                    key={field}
                    draftId={buildDraftId("node-raw", node.editorId, field)}
                    label={field}
                    value={value}
                    onCommit={(nextValue) => updateNodeRawField(node.editorId, field, nextValue)}
                    rows={3}
                    stringMode={typeof value === "string"}
                  />
                ),
              )}
          </div>
        </section>
        {renderTypeOptionsDialog()}
      </>
    );
  }

  if (selection.kind === "customAction") {
    const action = customActions[selection.customActionId];

    return (
      <>
        <section className="panel panel--inspector">
          <div className="panel__header">
            <div>
              <div className="panel__title">Custom Action Inspector</div>
              <div className="panel__subtitle">{selection.customActionId}</div>
            </div>
          </div>

          <div className="inspector-scroll">
            <BufferedStringField
              draftId={buildDraftId("custom-action", selection.customActionId, "name")}
              label="Name"
              value={String(action.raw.name ?? "")}
              onCommit={(nextValue) => renameCustomAction(selection.customActionId, nextValue)}
            />

            {Object.entries(action.raw).map(([field, value]) => {
              if (field === "id" || field === "name") {
                return null;
              }

              return isStructuredRecord(value) ? (
                <StructuredObjectEditor
                  key={field}
                  draftScope={buildDraftId("custom-action", selection.customActionId, field)}
                  typeRegistryKey={`custom-action:${selection.customActionId}:field:${field}`}
                  typeOptions={typeOptionRegistry}
                  label={field}
                  value={value}
                  onCommit={(nextValue) =>
                    updateCustomActionField(selection.customActionId, field, nextValue)
                  }
                  onManageTypeOptions={openTypeOptionsDialog}
                />
              ) : (
                <JsonTextarea
                  key={field}
                  draftId={buildDraftId("custom-action", selection.customActionId, field)}
                  label={field}
                  value={value}
                  onCommit={(nextValue) =>
                    updateCustomActionField(selection.customActionId, field, nextValue)
                  }
                  rows={field === "description" ? 3 : 6}
                  stringMode={typeof value === "string"}
                />
              );
            })}
          </div>
        </section>
        {renderTypeOptionsDialog()}
      </>
    );
  }

  const imageValue = images[selection.imageKey];

  return (
    <>
      <section className="panel panel--inspector">
        <div className="panel__header">
          <div>
            <div className="panel__title">Image Inspector</div>
            <div className="panel__subtitle">{selection.imageKey}</div>
          </div>
        </div>

        <div className="inspector-scroll">
          <div className="image-preview">
            <img src={buildImageSrc(imageValue)} alt={selection.imageKey} />
          </div>

          <JsonTextarea
            draftId={buildDraftId("image", selection.imageKey, "asset")}
            label="Base64 Asset"
            value={imageValue}
            onCommit={(nextValue) => updateImageAsset(selection.imageKey, String(nextValue))}
            rows={10}
            stringMode
          />
        </div>
      </section>
      {renderTypeOptionsDialog()}
    </>
  );
};
