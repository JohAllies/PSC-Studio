import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../store/editor-store";

type JsonTextareaProps = {
  draftId: string;
  label: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  rows?: number;
  stringMode?: boolean;
};

const formatValue = (value: unknown, stringMode: boolean) => {
  if (typeof value === "string" && stringMode) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

const parseLooseValue = (text: string, stringMode: boolean) => {
  if (stringMode) {
    return text;
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    return "";
  }

  const looksLikeJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("\"") ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d+(\.\d+)?$/.test(trimmed);

  if (!looksLikeJson) {
    return text;
  }

  return JSON.parse(text);
};

export const JsonTextarea = ({
  draftId,
  label,
  value,
  onCommit,
  rows = 8,
  stringMode = false,
}: JsonTextareaProps) => {
  const setPendingEdit = useEditorStore((state) => state.setPendingEdit);
  const setInvalidEdit = useEditorStore((state) => state.setInvalidEdit);
  const initialText = useMemo(() => formatValue(value, stringMode), [value, stringMode]);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (isFocused) {
      return;
    }
    setText(initialText);
    setError(null);
  }, [initialText, isFocused]);

  useEffect(() => {
    const pending = text !== initialText;
    setPendingEdit(draftId, pending);
    setInvalidEdit(draftId, pending && error !== null);
  }, [draftId, error, initialText, setInvalidEdit, setPendingEdit, text]);

  useEffect(
    () => () => {
      setPendingEdit(draftId, false);
      setInvalidEdit(draftId, false);
    },
    [draftId, setInvalidEdit, setPendingEdit],
  );

  const commitText = (nextText: string) => {
    try {
      const nextValue = parseLooseValue(nextText, stringMode);
      onCommit(nextValue);
      setError(null);
      setInvalidEdit(draftId, false);
      return nextValue;
    } catch (commitError) {
      setError((commitError as Error).message);
      setInvalidEdit(draftId, true);
      return null;
    }
  };

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea
        className={`editor-textarea${error ? " editor-textarea--error" : ""}`}
        rows={rows}
        value={text}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          try {
            parseLooseValue(nextText, stringMode);
            setError(null);
          } catch (commitError) {
            setError((commitError as Error).message);
          }
        }}
        onBlur={() => {
          setIsFocused(false);
          const committedValue = commitText(text);
          if (committedValue !== null) {
            setText(formatValue(committedValue, stringMode));
          }
        }}
      />
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
};
