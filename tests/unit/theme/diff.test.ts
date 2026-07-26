import { describe, it, expect } from 'vitest';
import { unifiedDiff } from '../../../src/theme/diff.js';

describe('unifiedDiff', () => {
  it('reports no change for identical content', () => {
    const res = unifiedDiff('a\nb\nc\n', 'a\nb\nc\n', { path: 'x.php' });
    expect(res.changed).toBe(false);
    expect(res.added).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.diff).toBe('');
  });

  it('counts additions and removals and emits a unified header', () => {
    const res = unifiedDiff('line1\nline2\nline3\n', 'line1\nCHANGED\nline3\n', {
      path: 'tpl.php',
    });
    expect(res.changed).toBe(true);
    expect(res.added).toBe(1);
    expect(res.removed).toBe(1);
    expect(res.diff).toContain('--- a/tpl.php');
    expect(res.diff).toContain('+++ b/tpl.php');
    expect(res.diff).toContain('-line2');
    expect(res.diff).toContain('+CHANGED');
    expect(res.diff).toContain('@@');
  });

  it('treats a new file (empty original) as all-added', () => {
    const res = unifiedDiff('', 'new\ncontent\n', { path: 'new.php' });
    expect(res.changed).toBe(true);
    expect(res.added).toBe(2);
    expect(res.removed).toBe(0);
    expect(res.diff).toContain('+new');
    expect(res.diff).toContain('+content');
  });

  it('includes surrounding context lines', () => {
    const oldStr = 'a\nb\nc\nd\ne\nf\ng\n';
    const newStr = 'a\nb\nc\nX\ne\nf\ng\n';
    const res = unifiedDiff(oldStr, newStr, { path: 'f.php', context: 2 });
    expect(res.diff).toContain(' b');
    expect(res.diff).toContain(' c');
    expect(res.diff).toContain('-d');
    expect(res.diff).toContain('+X');
    expect(res.diff).toContain(' e');
  });
});
