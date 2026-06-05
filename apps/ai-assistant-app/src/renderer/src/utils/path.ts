// relativeToRoot shows a path starting from the project root (e.g. "proj/apps/x.ts")
// instead of the full absolute path.
export function relativeToRoot(abs: string, root: string): string {
  if (!root || !abs.startsWith(root)) {
    return abs.split(/[\\/]/).pop() ?? abs
  }

  const rootName = root.split(/[\\/]/).pop() ?? ''
  const rest = abs.slice(root.length).replace(/^[\\/]+/, '')

  return rootName ? rootName + '/' + rest : rest
}
