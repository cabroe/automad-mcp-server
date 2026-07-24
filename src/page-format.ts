export interface EditorJsBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface NamedBlock {
  name: string;
  data: EditorJsBlock;
}

export interface ParsedPage {
  variables: Record<string, unknown>;
  blocks: NamedBlock[];
}

const VAR_RE = /^([a-zA-Z_][\w.-]*):\s*(.*)$/;
const BLOCK_RE = /^\+([a-zA-Z_][\w.-]*):\s*(.+)$/;

export function parsePage(raw: string): ParsedPage {
  const lines = raw.split(/\r?\n/);
  const variables: Record<string, unknown> = {};
  const blocks: NamedBlock[] = [];
  let inBlocks = false;

  for (const line of lines) {
    if (line === "-") {
      inBlocks = true;
      continue;
    }
    if (!inBlocks) {
      const m = VAR_RE.exec(line);
      if (m && m[1] !== undefined) {
        const key = m[1];
        const val = m[2] ?? "";
        variables[key] = parseValue(val);
      }
    } else {
      const m = BLOCK_RE.exec(line);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const name = m[1];
        const jsonStr = m[2];
        try {
          const data = JSON.parse(jsonStr) as EditorJsBlock;
          blocks.push({ name, data });
        } catch {
          // Skip malformed block — round-trip would drop it
        }
      }
    }
  }

  return { variables, blocks };
}

export function serializePage(page: ParsedPage): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(page.variables)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  if (page.blocks.length > 0) {
    lines.push("-");
    for (const block of page.blocks) {
      lines.push(`+${block.name}: ${JSON.stringify(block.data)}`);
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
