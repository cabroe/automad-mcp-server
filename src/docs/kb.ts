import { AutomadMcpError } from "../errors.js";
import { KB_PAGES } from "./kb/pages/index.js";

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly reference: string;
  readonly body: string;
}

export interface DocSummary {
  slug: string;
  title: string;
  tags: readonly string[];
  reference: string;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  score: number;
  snippet: string;
}

export function listDocs(): DocSummary[] {
  return KB_PAGES.map(({ slug, title, tags, reference }) => ({ slug, title, tags, reference }));
}

export function getDoc(slug: string): DocPage {
  const page = KB_PAGES.find((p) => p.slug === slug);
  if (!page) {
    throw new AutomadMcpError("NOT_FOUND", `unknown doc page '${slug}'`, { available: KB_PAGES.map((p) => p.slug) });
  }
  return page;
}

const DEFAULT_LIMIT = 5;
const SNIPPET_PADDING = 60;
const SNIPPET_TAIL = 140;
const SCORE_TITLE = 5;
const SCORE_TAG = 3;

export function searchDocs(query: string, limit = DEFAULT_LIMIT): DocSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    throw new AutomadMcpError("VALIDATION", "query must not be empty");
  }
  const hits: DocSearchHit[] = [];
  for (const page of KB_PAGES) {
    const titleLc = page.title.toLowerCase();
    const tagsLc = page.tags.join(" ").toLowerCase();
    const bodyLc = page.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      if (titleLc.includes(term)) score += SCORE_TITLE;
      if (tagsLc.includes(term)) score += SCORE_TAG;
      score += bodyLc.split(term).length - 1;
    }
    if (score > 0) {
      hits.push({ slug: page.slug, title: page.title, score, snippet: buildSnippet(page.body, terms) });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return hits.slice(0, Math.max(1, limit));
}

function buildSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - SNIPPET_PADDING);
  const end = Math.min(body.length, at + SNIPPET_TAIL);
  const raw = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${end < body.length ? "…" : ""}`;
}
