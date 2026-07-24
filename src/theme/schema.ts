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
export interface ThemeFieldTranslation { label?: string; options?: Record<string, string>; tooltip?: string; }
export interface ThemeSchemaTranslation { locale: string; path: string; fields: Record<string, ThemeFieldTranslation>; }
export interface ThemeSchema {
  theme: string;
  path: string;
  fields: ThemeSchemaField[];
  masks: { page: string[]; shared: string[] };
  templates: string[];
  blocks: string[];
  warnings: ThemeSchemaWarning[];
  locales: string[];
  translations: Record<string, ThemeSchemaTranslation>;
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
    const { locales, translations } = buildTranslations(analysis, manifest, warnings);
    warnings.sort((a, b) => a.code.localeCompare(b.code) || (a.field ?? "").localeCompare(b.field ?? "") || a.message.localeCompare(b.message));
    return {
      theme: analysis.theme,
      path: analysis.path,
      fields,
      masks: { page: [...analysis.masks.page], shared: [...analysis.masks.shared] },
      templates: [...analysis.files.templates],
      blocks: [...analysis.files.blocks],
      warnings,
      locales,
      translations,
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

function buildTranslations(
  analysis: ThemeAnalysis,
  manifest: Record<string, unknown> | undefined,
  warnings: ThemeSchemaWarning[],
): { locales: string[]; translations: Record<string, ThemeSchemaTranslation> } {
  const known = new Set<string>(analysis.fields);
  const fieldOrder = Array.isArray(manifest?.fieldOrder) ? manifest.fieldOrder : [];
  for (const field of fieldOrder) if (typeof field === "string") known.add(field);
  for (const section of [manifest?.labels, manifest?.options, manifest?.tooltips]) {
    const record = objectRecord(section);
    if (record) for (const field of Object.keys(record)) known.add(field);
  }
  const locales = Object.keys(analysis.translations).sort();
  const translations: Record<string, ThemeSchemaTranslation> = {};
  for (const locale of locales) {
    const source = analysis.translations[locale]!;
    const fields: Record<string, ThemeFieldTranslation> = {};
    translations[locale] = { locale, path: source.path, fields };
    const data = objectRecord(source.data);
    if (!data) {
      warnings.push({ code: "INVALID_I18N_ROOT", message: `Locale '${locale}': translation root must be an object` });
      continue;
    }
    const translated = new Map<string, ThemeFieldTranslation>();
    normalizeStringSection(data.labels, "label", "INVALID_I18N_LABEL", locale, translated, warnings);
    normalizeOptions(data.options, locale, translated, warnings);
    normalizeStringSection(data.tooltips, "tooltip", "INVALID_I18N_TOOLTIP", locale, translated, warnings);
    for (const field of [...translated.keys()].sort()) {
      fields[field] = { ...translated.get(field)! };
      if (!known.has(field)) warnings.push({ code: "UNKNOWN_TRANSLATION_FIELD", message: `Locale '${locale}': translated field '${field}' is not known by the theme schema`, field });
    }
  }
  return { locales, translations };
}

function normalizeStringSection(
  value: unknown,
  key: "label" | "tooltip",
  code: "INVALID_I18N_LABEL" | "INVALID_I18N_TOOLTIP",
  locale: string,
  fields: Map<string, ThemeFieldTranslation>,
  warnings: ThemeSchemaWarning[],
): void {
  if (value === undefined) return;
  const section = objectRecord(value);
  if (!section) {
    warnings.push({ code, message: `Locale '${locale}': ${key}s section must be an object` });
    return;
  }
  for (const [field, translated] of Object.entries(section)) {
    if (typeof translated !== "string") {
      warnings.push({ code, message: `Locale '${locale}': ${key} for '${field}' must be a string`, field });
      continue;
    }
    const target = fields.get(field) ?? {};
    target[key] = translated;
    fields.set(field, target);
  }
}

function normalizeOptions(
  value: unknown,
  locale: string,
  fields: Map<string, ThemeFieldTranslation>,
  warnings: ThemeSchemaWarning[],
): void {
  if (value === undefined) return;
  const section = objectRecord(value);
  if (!section) {
    warnings.push({ code: "INVALID_I18N_OPTIONS", message: `Locale '${locale}': options section must be an object` });
    return;
  }
  for (const [field, rawOptions] of Object.entries(section)) {
    const options = objectRecord(rawOptions);
    if (!options) {
      warnings.push({ code: "INVALID_I18N_OPTIONS", message: `Locale '${locale}': options for '${field}' must be an object`, field });
      continue;
    }
    const valid: Record<string, string> = {};
    for (const [option, translated] of Object.entries(options)) {
      if (typeof translated === "string") valid[option] = translated;
      else warnings.push({ code: "INVALID_I18N_OPTIONS", message: `Locale '${locale}': option '${option}' for '${field}' must be a string`, field });
    }
    if (Object.keys(valid).length > 0) {
      const target = fields.get(field) ?? {};
      target.options = valid;
      fields.set(field, target);
    }
  }
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
