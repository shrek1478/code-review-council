import { relative, isAbsolute } from 'node:path';

/** Cross-platform check: is `target` inside `root`? Uses path.relative to avoid separator issues. */
export function isWithinRoot(target: string, root: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && !isAbsolute(rel);
}
