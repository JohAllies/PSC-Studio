export type TypeOption = {
  value: string;
  label: string;
  hasOperator?: boolean;
  defaultOperator?: string | null;
  lockOperator?: boolean;
};

export type TypeOptionRegistry = Record<string, TypeOption[]>;

const STORAGE_KEY = "psc-studio-type-option-registry";

const isTypeOption = (value: unknown): value is TypeOption => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.value === "string" &&
    typeof record.label === "string" &&
    (record.hasOperator === undefined || typeof record.hasOperator === "boolean") &&
    (record.defaultOperator === undefined ||
      record.defaultOperator === null ||
      typeof record.defaultOperator === "string") &&
    (record.lockOperator === undefined || typeof record.lockOperator === "boolean")
  );
};

export const loadTypeOptionRegistry = (): TypeOptionRegistry => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.filter(isTypeOption) : [],
      ]),
    );
  } catch {
    return {};
  }
};

export const saveTypeOptionRegistry = (registry: TypeOptionRegistry) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Ignore local preference persistence failures.
  }
};

const humanizeValue = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const getTypeOptionsForTarget = (
  registry: TypeOptionRegistry,
  targetKey: string,
  currentValue: unknown,
): TypeOption[] => {
  const configured = registry[targetKey] ?? [];

  if (typeof currentValue !== "string" || currentValue.length === 0) {
    return configured;
  }

  if (configured.some((option) => option.value === currentValue)) {
    return configured;
  }

  return [
    {
      value: currentValue,
      label: humanizeValue(currentValue),
    },
    ...configured,
  ];
};

export const getTypeOptionConfigForTarget = (
  registry: TypeOptionRegistry,
  targetKey: string,
  currentValue: unknown,
): TypeOption | null => {
  if (typeof currentValue !== "string" || currentValue.length === 0) {
    return null;
  }

  return (
    getTypeOptionsForTarget(registry, targetKey, currentValue).find(
      (option) => option.value === currentValue,
    ) ?? null
  );
};
