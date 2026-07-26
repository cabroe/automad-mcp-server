import type { DocPage } from "../../kb.js";
import { page as templateSyntax } from "./template-syntax.js";
import { page as controlStructures } from "./control-structures.js";
import { page as navigation } from "./navigation.js";
import { page as i18n } from "./i18n.js";
import { page as blocks } from "./blocks.js";
import { page as themeJson } from "./theme-json.js";
import { page as headless } from "./headless-api.js";
import { page as gettingStarted } from "./getting-started.js";
import { page as commonPitfalls } from "./common-pitfalls.js";
import { page as includePathResolution } from "./include-path-resolution.js";
import { page as customFunctions } from "./custom-functions.js";
import { page as runtimeLang } from "./runtime-lang.js";
import { page as snippetInheritance } from "./snippet-inheritance.js";

export const KB_PAGES: readonly DocPage[] = [
  templateSyntax,
  controlStructures,
  navigation,
  i18n,
  blocks,
  themeJson,
  headless,
  gettingStarted,
  commonPitfalls,
  includePathResolution,
  customFunctions,
  runtimeLang,
  snippetInheritance,
] as const;
