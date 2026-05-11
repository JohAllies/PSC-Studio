export type OperatorOption = {
  value: string;
  label: string;
};

// Temporary registry for inspector operator dropdowns.
// This is intentionally simple so it can be replaced later by a reference file
// or moved behind an admin/editor configuration screen.
export const OPERATOR_OPTIONS: OperatorOption[] = [
  { value: "EQUALS", label: "Equals" },
  { value: "DOES_NOT_EQUAL", label: "Does Not Equal" },
  { value: "GREATER_THAN", label: "Greater Than" },
  { value: "GREATER_THAN_OR_EQUAL", label: "Greater Than Or Equal" },
  { value: "GREATER_THAN_OR_EQUALS", label: "Greater Than Or Equals" },
  { value: "LESS_THAN", label: "Less Than" },
  { value: "LESS_THAN_OR_EQUAL", label: "Less Than Or Equal" },
  { value: "LESS_THAN_OR_EQUALS", label: "Less Than Or Equals" },
  { value: "CONTAINS", label: "Contains" },
  { value: "DOES_NOT_CONTAIN", label: "Does Not Contain" },
  { value: "IS_TRUE", label: "Is True" },
  { value: "IS_FALSE", label: "Is False" },
  { value: "IS_IN_LIST", label: "Is In List" },
  { value: "NOT_IN_LIST", label: "Not In List" },
];

const humanizeOperator = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const getOperatorOptions = (currentValue: unknown): OperatorOption[] => {
  if (typeof currentValue !== "string" || currentValue.length === 0) {
    return OPERATOR_OPTIONS;
  }

  if (OPERATOR_OPTIONS.some((option) => option.value === currentValue)) {
    return OPERATOR_OPTIONS;
  }

  return [{ value: currentValue, label: humanizeOperator(currentValue) }, ...OPERATOR_OPTIONS];
};
