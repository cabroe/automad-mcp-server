/**
 * Minimal line-based unified diff (LCS). Theme files are small, so O(n*m) is
 * fine and keeps the dependency footprint at zero. Used by `theme.diff` to
 * preview a `theme.write` before it touches disk.
 */
export interface DiffResult {
  path: string;
  changed: boolean;
  added: number;
  removed: number;
  /** Unified-diff text, or empty string when identical. */
  diff: string;
}

export function unifiedDiff(
  oldStr: string,
  newStr: string,
  opts: { path?: string; context?: number } = {},
): DiffResult {
  const path = opts.path ?? 'file';
  const context = opts.context ?? 3;
  const a = splitLines(oldStr);
  const b = splitLines(newStr);

  const ops = diffLines(a, b);
  const added = ops.filter((op) => op.type === 'add').length;
  const removed = ops.filter((op) => op.type === 'del').length;
  if (added === 0 && removed === 0) {
    return { path, changed: false, added: 0, removed: 0, diff: '' };
  }

  const hunks = buildHunks(ops, context);
  const header = `--- a/${path}\n+++ b/${path}\n`;
  const body = hunks
    .map((hunk) => {
      const head = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      return [head, ...hunk.lines].join('\n');
    })
    .join('\n');

  return { path, changed: true, added, removed, diff: `${header}${body}\n` };
}

interface Op {
  type: 'eq' | 'add' | 'del';
  line: string;
}

function splitLines(str: string): string[] {
  if (str === '') return [];
  const parts = str.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline terminates the last line; drop the empty tail element.
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Classic LCS backtrack into equal/add/del operations. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'del', line: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++]! });
  while (j < m) ops.push({ type: 'add', line: b[j++]! });
  return ops;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function buildHunks(ops: Op[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let current: Hunk | null = null;
  let trailingContext = 0;

  const flush = (): void => {
    if (current) {
      hunks.push(current);
      current = null;
      trailingContext = 0;
    }
  };

  // Pre-compute positions to build leading context. Simple approach: walk ops,
  // opening a hunk on first change and closing after `context` equal lines.
  const pending: Op[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx]!;
    if (op.type === 'eq') {
      pending.push(op);
      if (current) {
        current.lines.push(` ${op.line}`);
        current.oldLines++;
        current.newLines++;
        trailingContext++;
        if (trailingContext >= context) flush();
      }
      oldLine++;
      newLine++;
    } else {
      if (!current) {
        const lead = pending.slice(-context);
        const oldStart = oldLine - lead.length;
        const newStart = newLine - lead.length;
        current = {
          oldStart: Math.max(1, oldStart),
          oldLines: 0,
          newStart: Math.max(1, newStart),
          newLines: 0,
          lines: [],
        };
        for (const ctx of lead) {
          current.lines.push(` ${ctx.line}`);
          current.oldLines++;
          current.newLines++;
        }
      }
      trailingContext = 0;
      if (op.type === 'del') {
        current.lines.push(`-${op.line}`);
        current.oldLines++;
        oldLine++;
      } else {
        current.lines.push(`+${op.line}`);
        current.newLines++;
        newLine++;
      }
    }
  }
  flush();
  return hunks;
}
