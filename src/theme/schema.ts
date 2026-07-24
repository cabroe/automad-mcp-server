import type { ThemeAnalysis } from "./analyzer.js";

export type ThemeFieldType = "text" | "checkbox" | "color" | "image" | "icon" | "select" | "url" | "format" | "label" | "filter" | "block";
export type ThemeFieldScope = "page" | "shared" | "unmasked";

export interface ThemeSchemaWarning { code: string; message: string; field?: string; }
export interface ThemeSchemaField {
  name: string;
  type: ThemeFieldType;
  scope: ThemeFieldScope;
  source: string[];
  label?: string;
  options?: Record<string, string>;
  tooltip?: string;
  order?: number;
}
export interface ThemeSchema {
  theme: string;
  path: string;
  fields: ThemeSchemaField[];
  masks: { page: string[]; shared: string[] };
  templates: string[];
  blocks: string[];
  warnings: ThemeSchemaWarning[];
}

const PREFIX_TYPES: Array<[string, ThemeFieldType]> = [
  ["checkbox", "checkbox"],
  ["color", "color"],
  ["image", "image"],
  ["icon", "icon"],
  ["select", "select"],
  ["text", "text"],
  ["url", "url"],
  ["format", "format"],
  ["label", "label"],
  ["filter", "filter"],
];

export class ThemeSchemaBuilder {
  build(analysis: ThemeAnalysis): ThemeSchema {
    const manifest = analysis.manifests.theme;
    const warnings: ThemeSchemaWarning[] = analysis.issues.map(({ code, message }) => ({ code, message }));
    const labels = objectRecord(manifest?.labels);
    const options = objectRecord(manifest?.options);
    const tooltips = objectRecord(manifest?.tooltips);
    const orders = readOrders(manifest?.fieldOrder, warnings);
    const fields = analysis.fields.map((name) => {
      const type = fieldType(name, warnings);
      const inPage = analysis.masks.page.includes(name);
      const inShared = analysis.masks.shared.includes(name);
      if (inPage && inShared) warnings.push({ code: "FIELD_SCOPE_CONFLICT", message: `Field '${name}' is listed in both page and shared masks`, field: name });
      const field: ThemeSchemaField = {
        name,
        type,
        scope: inShared ? "shared" : inPage ? "page" : "unmasked",
        source: [...(analysis.fieldSources[name] ?? [])].sort(),
      };
      const label = labels?.[name];
      if (label !== undefined) {
        if (typeof label === "string") field.label = label;
        else warnings.push({ code: "INVALID_FIELD_LABEL", message: `Label for '${name}' must be a string`, field: name });
      }
      const fieldOptions = options?.[name];
      if (fieldOptions !== undefined) {
        if (isStringRecord(fieldOptions)) field.options = { ...fieldOptions };
        else warnings.push({ code: "INVALID_FIELD_OPTIONS", message: `Options for '${name}' must be an object of strings`, field: name });
      }
      const tooltip = tooltips?.[name];
      if (tooltip !== undefined) {
        if (typeof tooltip === "string") field.tooltip = tooltip;
        else warnings.push({ code: "INVALID_FIELD_TOOLTIP", message: `Tooltip for '${name}' must be a string`, field: name });
      }
      const order = orders.get(name);
      if (order !== undefined) field.order = order;
      return field;
    });
    fields.sort((a, b) => (a.order === undefined ? 1 : b.order === undefined ? -1 : a.order - b.order) || a.name.localeCompare(b.name));
    warnings.sort((a, b) => a.code.localeCompare(b.code) || (a.field ?? "").localeCompare(b.field ?? "") || a.message.localeCompare(b.message));
    return {
      theme: analysis.theme,
      path: analysis.path,
      fields,
      masks: { page: [...analysis.masks.page], shared: [...analysis.masks.shared] },
      templates: [...analysis.files.templates],
      blocks: [...analysis.files.blocks],
      warnings,
    };
  }
}

function fieldType(name: string, warnings: ThemeSchemaWarning[]): ThemeFieldType {
  if (name.startsWith("+") && name.length > 1) return "block";
  for (const [prefix, type] of PREFIX_TYPES) {
    if (name.startsWith(prefix) && name.length > prefix.length) return type;
  }
  warnings.push({ code: "UNKNOWN_FIELD_PREFIX", message: `Field '${name}' has no recognized Automad field prefix; defaulting to text`, field: name });
  return "text";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function isStringRecord(value: unknown): value is Record<string, string> {
  const record = objectRecord(value);
  return record !== undefined && Object.values(record).every((entry) => typeof entry === "string");
}
function readOrders(value: unknown, warnings: ThemeSchemaWarning[]): Map<string, number> {
  const orders = new Map<string, number>();
  if (value === undefined) return orders;
  if (!Array.isArray(value)) {
    warnings.push({ code: "INVALID_FIELD_ORDER", message: "fieldOrder must be an array" });
    return orders;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      warnings.push({ code: "INVALID_FIELD_ORDER", message: `fieldOrder entry at index ${index} must be a string` });
      return;
    }
    if (orders.has(entry)) {
      warnings.push({ code: "DUPLICATE_FIELD_ORDER", message: `fieldOrder contains '${entry}' more than once`, field: entry });
      return;
    }
    orders.set(entry, index);
  });
  return orders;
}
