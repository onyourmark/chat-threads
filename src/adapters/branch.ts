/**
 * Active-branch reconstruction, shared by both adapters.
 *
 * ChatGPT and Claude both store a conversation as a tree of messages plus a
 * pointer to the leaf the user is currently looking at. The active branch is
 * the path from that leaf back to the root. Alternate branches — earlier
 * versions of an edited prompt, regenerated answers the user scrolled past —
 * hang off that path and are deliberately left out.
 */

/** Minimal shape needed to walk a message tree. */
export interface BranchNode {
  id: string;
  parentId?: string | null;
}

export interface BranchResult<T extends BranchNode> {
  /** Root-to-leaf path. Empty when the leaf is unknown or unreachable. */
  path: T[];
  /** True when a complete path from the leaf back to a root was found. */
  reliable: boolean;
  /** Why the walk stopped early, when it did. */
  warning?: string;
}

/**
 * Walk from `leafId` up through `parentId` links and return the path in
 * conversation order (oldest first).
 *
 * A cycle or a dangling parent stops the walk and marks the result
 * unreliable rather than guessing — a wrong branch would silently produce a
 * transcript the user never had.
 */
export function activeBranch<T extends BranchNode>(
  nodes: Map<string, T>,
  leafId: string | undefined | null,
): BranchResult<T> {
  if (!leafId || !nodes.has(leafId)) {
    return {
      path: [],
      reliable: false,
      warning: leafId
        ? 'The conversation data did not contain the message the page is currently showing.'
        : 'The conversation data did not say which branch is being displayed.',
    };
  }

  const path: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = leafId;
  let warning: string | undefined;

  while (cursor) {
    if (seen.has(cursor)) {
      warning = 'The conversation data contained a loop and was cut short.';
      break;
    }
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (!node) {
      warning =
        'Part of the conversation history referenced a message that was not included.';
      break;
    }
    path.push(node);
    cursor = node.parentId ?? null;
  }

  path.reverse();
  return { path, reliable: !warning, warning };
}

/**
 * Fallback ordering when a provider returns a flat list with no usable tree.
 *
 * Sorts by the provided index only; it never reorders by timestamp, because a
 * provider that omits parent links usually also serves messages in display
 * order and a timestamp sort would scramble same-second turns.
 */
export function flatOrder<T>(items: T[]): T[] {
  return items.slice();
}
