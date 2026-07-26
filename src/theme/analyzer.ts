import * as path from "node:path";
import { AutomadMcpError } from "../errors.js";
import { type ThemeFs, assertWithinRoot } from "./fs.js";

export type FindingSeverity = "error" | "warning" | "info";
export interface ThemeFinding { severity: FindingSeverity; code: string; message: string; path?: string; line?: number; }
export interface ThemeTranslationSource {
  locale: string;
  path: string;
  data: Record<string, unknown>;
}
export interface ThemeAnalysis {
  theme: string;
  path: string;
  manifests: { theme?: Record<string, unknown>; package?: Record<string, unknown>; composer?: Record<string, unknown> };
  files: { templates: string[]; components: string[]; blocks: string[]; client: string[]; icons: string[]; i18n: string[]; lib: string[]; build: string[]; other: string[] };
  fields: string[];
  fieldSources: Record<string, string[]>;
  translations: Record<string, ThemeTranslationSource>;
  blockFields: string[];
  /** Files that define and that invoke the canonical `main` snippet. */
  mainSnippet: { definedIn: string[]; invokedIn: string[] };
  /** Files referencing the runtime variable `@{ :lang }`. */
  runtimeLangFiles: string[];
  masks: { page: string[]; shared: string[] };
  starterKit: { detected: boolean; markers: string[] };
  issues: ThemeFinding[];
}
export interface ThemeValidation extends ThemeAnalysis { ok: boolean; findings: ThemeFinding[]; summary: { errors: number; warnings: number; info: number }; }

const MAX_SOURCE_BYTES = 512 * 1024;
const FIELD_RE = /@\{\s*([+A-Za-z][A-Za-z0-9_-]*)\b/g;
const IGNORED_FIELDS = new Set(["true", "false", "null", "if", "else", "foreach", "with"]);
const STARTER_MARKERS = ["theme.json", "package.json", "client/index.ts", "client/styles", "esbuild.js"];
const MAIN_SNIPPET_DEFINE_RE = /<@~?\s*snippet\s+main\s*~?@>/;
const MAIN_SNIPPET_INVOKE_RE = /<@~?\s*main\s*~?@>/;
const RUNTIME_LANG_RE = /@\{\s*:lang\b([^}]*)\}/g;
const DEF_FALLBACK_RE = /\bdef\s*\(/;
const REQUIRED_BUILD_MARKERS = ["package.json", "client/index.ts", "client/styles", "esbuild.js"];

export class ThemeAnalyzer {
  constructor(private readonly deps: { fs: ThemeFs; themesPath: string }) {}

  async analyze(theme: string): Promise<ThemeAnalysis> {
    const themePath = await this.resolveTheme(theme);
    const files = await this.discoverFiles(themePath);
    const issues: ThemeFinding[] = [];
    const manifests: ThemeAnalysis["manifests"] = {};
    await this.readManifest(themePath, files, "theme.json", "theme", manifests, issues);
    await this.readManifest(themePath, files, "package.json", "package", manifests, issues);
    await this.readManifest(themePath, files, "composer.json", "composer", manifests, issues);
    const translations: Record<string, ThemeTranslationSource> = {};
    for (const relPath of files.i18n.filter((value) => /^i18n\/[^/]+\.json$/.test(value)).sort()) {
      const parsed = await this.readJson(themePath, relPath, "I18N_JSON_INVALID", issues);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const locale = path.basename(relPath, ".json");
      if (translations[locale]) {
        issues.push({ severity: "warning", code: "DUPLICATE_I18N_LOCALE", message: `Duplicate i18n locale '${locale}' at ${relPath}`, path: relPath });
        continue;
      }
      translations[locale] = { locale, path: relPath, data: parsed as Record<string, unknown> };
    }
    if (await this.deps.fs.isDirectory(path.join(themePath, "i18n")) && files.i18n.length === 0) {
      issues.push({ severity: "warning", code: "I18N_DIRECTORY_EMPTY", message: "i18n directory contains no JSON translations", path: "i18n" });
    }
    const mainSnippetDefinedIn: string[] = [];
    const mainSnippetInvokedIn: string[] = [];
    const runtimeLangFiles: string[] = [];
    const fields = new Set<string>();
    const sourceMap = new Map<string, Set<string>>();
    for (const relPath of [...files.templates, ...files.components, ...files.blocks]) {
      let source = await this.deps.fs.readFile(path.join(themePath, relPath));
      if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
        issues.push({ severity: "warning", code: "SOURCE_TRUNCATED", message: `source exceeded ${MAX_SOURCE_BYTES} bytes and was truncated`, path: relPath });
        source = Buffer.from(source, "utf8").subarray(0, MAX_SOURCE_BYTES).toString("utf8");
      }
      for (const match of source.matchAll(FIELD_RE)) {
        const field = match[1];
        if (!field || IGNORED_FIELDS.has(field)) continue;
        fields.add(field);
        const sources = sourceMap.get(field) ?? new Set<string>();
        sources.add(relPath);
        sourceMap.set(field, sources);
      }
      if (MAIN_SNIPPET_DEFINE_RE.test(source)) mainSnippetDefinedIn.push(relPath);
      if (MAIN_SNIPPET_INVOKE_RE.test(source)) mainSnippetInvokedIn.push(relPath);
      for (const match of source.matchAll(RUNTIME_LANG_RE)) {
        if (!DEF_FALLBACK_RE.test(match[1] ?? "")) {
          runtimeLangFiles.push(relPath);
          break;
        }
      }
    }
    for (const relPath of [...files.lib, ...files.other]) {
      if (!relPath.endsWith(".php")) continue;
      const source = await this.deps.fs.readFile(path.join(themePath, relPath));
      const capped = Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES
        ? Buffer.from(source, "utf8").subarray(0, MAX_SOURCE_BYTES).toString("utf8")
        : source;
      if (MAIN_SNIPPET_DEFINE_RE.test(capped)) mainSnippetDefinedIn.push(relPath);
    }
    const fieldList = [...fields].sort();
    const fieldSources = Object.fromEntries(
      [...sourceMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, sources]) => [field, [...sources].sort()]),
    );
    const blockFields = fieldList.filter((field) => field.startsWith("+"));
    const masks = readMasks(manifests.theme, issues);
    const markers = STARTER_MARKERS.filter((marker) => markerExists(marker, files, manifests));
    const starterKit = { detected: markers.length >= 3, markers };
    if (starterKit.detected) issues.push({ severity: "info", code: "STARTER_KIT_STRUCTURE_DETECTED", message: "recognized Automad Theme Starter Kit structure detected" });
    for (const field of blockFields) issues.push({ severity: "info", code: "BLOCK_FIELD_DETECTED", message: `block field '${field}' detected` });
    if (isBuildScriptDetected(manifests.package, files.build)) issues.push({ severity: "info", code: "BUILD_SCRIPT_DETECTED", message: "Starter Kit build script detected", path: "package.json" });
    return { theme, path: themePath, manifests, files, fields: fieldList, fieldSources, blockFields, mainSnippet: { definedIn: mainSnippetDefinedIn, invokedIn: mainSnippetInvokedIn }, runtimeLangFiles, masks, starterKit, translations, issues };
  }

  async validate(theme: string): Promise<ThemeValidation> {
    const analysis = await this.analyze(theme);
    const findings = [...analysis.issues];
    const manifest = analysis.manifests.theme;
    const name = manifest?.name;
    if (manifest && (typeof name !== "string" || !name.trim())) findings.push({ severity: "error", code: "THEME_NAME_MISSING", message: "theme.json must define a non-empty name", path: "theme.json" });
    if (analysis.files.templates.length === 0) findings.push({ severity: "error", code: "THEME_TEMPLATE_MISSING", message: "theme has no root-level .php template", path: "." });
    this.addMetadataFindings(analysis, findings);
    this.addFieldFindings(analysis, findings);
    const [firstMainInvoker] = analysis.mainSnippet.invokedIn;
    if (firstMainInvoker && analysis.mainSnippet.definedIn.length === 0) {
      findings.push({
        severity: "warning",
        code: "MAIN_SNIPPET_UNDEFINED",
        message:
          "template invokes <@ main @> but no <@~ snippet main ~@> is defined in this theme — the rendered <main> will be empty; see automad_docs.get('snippet-inheritance')",
        path: firstMainInvoker,
      });
    }
    const [firstLangFile] = analysis.runtimeLangFiles;
    if (firstLangFile && Object.keys(analysis.translations).length === 0) {
      findings.push({
        severity: "warning",
        code: "LANG_WITHOUT_I18N",
        message:
          "template uses @{ :lang } but the theme ships no i18n/*.json translations — see automad_docs.get('runtime-lang')",
        path: firstLangFile,
      });
    }
    if (analysis.starterKit.detected && REQUIRED_BUILD_MARKERS.some((marker) => !analysis.starterKit.markers.includes(marker))) {
      findings.push({ severity: "warning", code: "STARTER_BUILD_INCOMPLETE", message: "Starter Kit structure is missing one or more build markers", path: "." });
    }
    if (analysis.files.templates.length > 0) {
      // B6 (from IMPROVEMENT-PROMPT.md): every page's data file must set BOTH
      // `theme` AND `template` — setting only one yields "Template missing!
      // <theme>/.php" at render time. We can't inspect page data here, so we
      // emit an info-level reminder once per theme.
      findings.push({
        severity: "info",
        code: "PAGE_DATA_TEMPLATE_REQUIRED",
        message: "Every page's data file must set both `theme` and `template` to be renderable — see automad_docs.get('common-pitfalls')",
        path: "pages/*/data",
      });
    }
    findings.sort(compareFindings);
    const summary = {
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
    return { ...analysis, ok: summary.errors === 0, findings, summary };
  }

  private async resolveTheme(theme: string): Promise<string> {
    const themePath = assertWithinRoot(this.deps.themesPath, path.join(this.deps.themesPath, theme));
    if (!(await this.deps.fs.exists(themePath))) throw new AutomadMcpError("NOT_FOUND", `theme '${theme}' not found at ${themePath}`);
    return themePath;
  }

  private async discoverFiles(themePath: string): Promise<ThemeAnalysis["files"]> {
    const all = (await this.deps.fs.list(themePath, { recursive: true })).map((file) => path.relative(themePath, file).split(path.sep).join("/")).sort();
    const files: ThemeAnalysis["files"] = { templates: [], components: [], blocks: [], client: [], icons: [], i18n: [], lib: [], build: [], other: [] };
    for (const rel of all) {
      if (!rel.includes("/") && rel.endsWith(".php")) files.templates.push(rel);
      else if (rel.startsWith("components/")) files.components.push(rel);
      else if (rel.startsWith("blocks/")) files.blocks.push(rel);
      else if (rel.startsWith("client/")) files.client.push(rel);
      else if (rel.startsWith("icons/")) files.icons.push(rel);
      else if (rel.startsWith("i18n/")) files.i18n.push(rel);
      else if (rel.startsWith("lib/")) files.lib.push(rel);
      else if (isBuildFile(rel)) files.build.push(rel);
      else files.other.push(rel);
    }
    return files;
  }

  private async readManifest(themePath: string, files: ThemeAnalysis["files"], relPath: string, key: "theme" | "package" | "composer", manifests: ThemeAnalysis["manifests"], issues: ThemeFinding[]): Promise<void> {
    if (![...files.build, ...files.other].includes(relPath)) {
      if (key === "theme") issues.push({ severity: "error", code: "THEME_MANIFEST_MISSING", message: "theme.json is missing", path: relPath });
      return;
    }
    const parsed = await this.readJson(themePath, relPath, key === "theme" ? "THEME_MANIFEST_INVALID" : `${key.toUpperCase()}_JSON_INVALID`, issues);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) manifests[key] = parsed as Record<string, unknown>;
  }

  private async readJson(themePath: string, relPath: string, invalidCode: string, issues: ThemeFinding[]): Promise<unknown> {
    try {
      const parsed: unknown = JSON.parse(await this.deps.fs.readFile(path.join(themePath, relPath)));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object");
      return parsed;
    } catch {
      issues.push({ severity: "error", code: invalidCode, message: `${relPath} is not valid JSON object`, path: relPath });
      return undefined;
    }
  }

  private addMetadataFindings(analysis: ThemeAnalysis, findings: ThemeFinding[]): void {
    const theme = analysis.manifests.theme;
    if (!theme) return;
    for (const [name, manifest] of [["package", analysis.manifests.package], ["composer", analysis.manifests.composer]] as const) {
      if (!manifest) continue;
      for (const field of ["description", "author", "license", "version"] as const) {
        if (typeof theme[field] === "string" && theme[field] && typeof manifest[field] === "string" && manifest[field] && theme[field] !== manifest[field]) {
          findings.push({ severity: "warning", code: `${name.toUpperCase()}_METADATA_MISMATCH`, message: `${name}.json ${field} differs from theme.json`, path: `${name}.json` });
        }
      }
    }
  }

  private addFieldFindings(analysis: ThemeAnalysis, findings: ThemeFinding[]): void {
    const theme = analysis.manifests.theme;
    const known = new Set<string>([
      ...(Array.isArray(theme?.fieldOrder) ? theme.fieldOrder.filter((value): value is string => typeof value === "string") : []),
      ...(theme?.labels && typeof theme.labels === "object" ? Object.keys(theme.labels) : []),
      ...(theme?.options && typeof theme.options === "object" ? Object.keys(theme.options) : []),
      ...(theme?.tooltips && typeof theme.tooltips === "object" ? Object.keys(theme.tooltips) : []),
    ]);
    for (const field of analysis.fields) {
      if (field.startsWith("+")) continue;
      if (!analysis.masks.page.includes(field) && !analysis.masks.shared.includes(field) && !known.has(field)) findings.push({ severity: "warning", code: "FIELD_NOT_MASKED", message: `field '${field}' is not listed in masks.page or masks.shared` });
    }
    for (const field of [...analysis.masks.page, ...analysis.masks.shared]) {
      if (!analysis.fields.includes(field) && !known.has(field)) findings.push({ severity: "warning", code: "MASK_FIELD_UNUSED", message: `mask field '${field}' is not referenced by templates`, path: "theme.json" });
    }
  }
}

function isBuildFile(rel: string): boolean {
  return ["theme.json", "package.json", "composer.json", "esbuild.js", "postcss.config.js", "tsconfig.json"].includes(rel) || rel.startsWith("bin/");
}
function markerExists(marker: string, files: ThemeAnalysis["files"], manifests: ThemeAnalysis["manifests"]): boolean {
  if (marker === "theme.json") return Boolean(manifests.theme);
  if (marker === "package.json") return Boolean(manifests.package);
  if (marker === "client/styles") return files.client.some((file) => file.startsWith("client/styles/"));
  return files.client.includes(marker) || files.build.includes(marker) || files.other.includes(marker);
}
function isBuildScriptDetected(pkg: Record<string, unknown> | undefined, buildFiles: string[]): boolean {
  const scripts = pkg?.scripts;
  return Boolean(pkg && buildFiles.includes("esbuild.js") && scripts && typeof scripts === "object" && !Array.isArray(scripts) && (scripts as Record<string, unknown>).build === "node esbuild.js");
}
function readMasks(manifest: Record<string, unknown> | undefined, issues: ThemeFinding[]): { page: string[]; shared: string[] } {
  const masks = manifest?.masks;
  if (!masks || typeof masks !== "object" || Array.isArray(masks)) return { page: [], shared: [] };
  const result: { page: string[]; shared: string[] } = { page: [], shared: [] };
  for (const key of ["page", "shared"] as const) {
    const value = (masks as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      issues.push({ severity: "error", code: "THEME_MASKS_INVALID", message: `theme.json masks.${key} must be an array of strings`, path: "theme.json" });
      continue;
    }
    result[key] = value;
  }
  return result;
}
function compareFindings(a: ThemeFinding, b: ThemeFinding): number {
  const rank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  return rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code) || (a.path ?? "").localeCompare(b.path ?? "");
}
