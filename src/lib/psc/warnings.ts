import type { PscDocument, PscNode, PscWarning } from "../../types/psc";

const VARIABLE_REF_PATTERN = /\b(?:v|var)\(([^)]+)\)/g;
const PARAM_REF_PATTERN = /\b(?:p|param)\(([^)]+)\)/g;
const CUSTOM_CALL_PATTERN = /^CUSTOM_(.+)$/;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectRefsFromValue = (
  value: unknown,
  variableRefs: Set<string>,
  parameterRefs: Set<string>,
) => {
  if (typeof value === "string") {
    for (const match of value.matchAll(VARIABLE_REF_PATTERN)) {
      variableRefs.add(match[1]);
    }

    for (const match of value.matchAll(PARAM_REF_PATTERN)) {
      parameterRefs.add(match[1]);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectRefsFromValue(entry, variableRefs, parameterRefs));
    return;
  }

  if (isPlainRecord(value)) {
    Object.values(value).forEach((entry) =>
      collectRefsFromValue(entry, variableRefs, parameterRefs),
    );
  }
};

const collectDefinedVariables = (
  nodes: PscNode[],
  variables: Set<string>,
  warnings: PscWarning[],
  locationPrefix: string,
) => {
  nodes.forEach((node, index) => {
    const location = `${locationPrefix} > ${node.id}[${index}]`;
    const props = isPlainRecord(node.properties) ? node.properties : undefined;
    const variableName = props?.["Variable name"];

    if (
      typeof variableName === "string" &&
      (node.id.startsWith("SET_VARIABLE") || node.id.startsWith("INCREMENT_VARIABLE"))
    ) {
      variables.add(variableName);
    }

    if (!node.id) {
      warnings.push({
        id: `${location}-missing-id`,
        severity: "warning",
        location,
        message: "Node is missing an id field.",
      });
    }

    collectDefinedVariables(node.children ?? [], variables, warnings, location);
  });
};

const warnForReferences = (
  nodes: PscNode[],
  definedVariables: Set<string>,
  warnings: PscWarning[],
  locationPrefix: string,
  customActions: Record<string, unknown>,
) => {
  nodes.forEach((node, index) => {
    const location = `${locationPrefix} > ${node.id}[${index}]`;
    const variableRefs = new Set<string>();
    const parameterRefs = new Set<string>();
    const props = isPlainRecord(node.properties) ? node.properties : undefined;

    if (!props && "properties" in node && node.properties !== undefined) {
      warnings.push({
        id: `${location}-properties-shape`,
        severity: "info",
        location,
        message: "Node properties exist but are not an object. PSC Studio will preserve them unchanged.",
      });
    }

    collectRefsFromValue(props, variableRefs, parameterRefs);

    variableRefs.forEach((variableName) => {
      if (!definedVariables.has(variableName)) {
        warnings.push({
          id: `${location}-variable-${variableName}`,
          severity: "info",
          location,
          message: `Variable reference "${variableName}" has no local definition in this document.`,
        });
      }
    });

    const customCall = node.id.match(CUSTOM_CALL_PATTERN);
    if (customCall && !(customCall[1] in customActions)) {
      warnings.push({
        id: `${location}-custom-action`,
        severity: "warning",
        location,
        message: `Custom action call "${node.id}" does not match an embedded custom action definition.`,
      });
    }

    if ((node.id === "IF_VARIABLE_IS" || node.id === "SET_VARIABLE") && !props?.["Variable name"]) {
      warnings.push({
        id: `${location}-variable-name`,
        severity: "info",
        location,
        message: `${node.id} is missing "Variable name". PSC may tolerate this, but the script is suspicious.`,
      });
    }

    if (parameterRefs.size > 0 && locationPrefix === "Main Actions") {
      warnings.push({
        id: `${location}-parameter-ref`,
        severity: "info",
        location,
        message: "Custom action parameter syntax was found in the main action tree.",
      });
    }

    warnForReferences(
      node.children ?? [],
      definedVariables,
      warnings,
      location,
      customActions,
    );
  });
};

export const analyzeDocumentWarnings = (document: PscDocument): PscWarning[] => {
  const warnings: PscWarning[] = [];
  const definedVariables = new Set<string>();
  const customActions = document.customActions ?? {};

  collectDefinedVariables(document.actions ?? [], definedVariables, warnings, "Main Actions");

  Object.entries(customActions).forEach(([customActionId, customAction]) => {
    collectDefinedVariables(
      customAction.actions ?? [],
      definedVariables,
      warnings,
      `Custom Action ${customActionId}`,
    );
  });

  warnForReferences(
    document.actions ?? [],
    definedVariables,
    warnings,
    "Main Actions",
    customActions,
  );

  Object.entries(customActions).forEach(([customActionId, customAction]) => {
    warnForReferences(
      customAction.actions ?? [],
      definedVariables,
      warnings,
      `Custom Action ${customActionId}`,
      customActions,
    );
  });

  return warnings;
};
