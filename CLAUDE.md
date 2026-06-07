# Project conventions — ai-architect

## This is a large, complex application — build for extension, never for the quick win

ai-architect is a big, multi-service system (Electron app + several Go services behind a
gateway, a plugin system, a command/agent layer, a multi-view shell). Treat every change as a
foundation others will build on, not a one-off patch.

**Do not take shortcuts.** A solution that "works for now" but is hard to extend is wrong here.
Prefer the design that will still be clean when the feature grows.

Concretely:

- **Abstract the right seams.** Model new capabilities as interfaces / registries / small
  composable units (e.g. the classifiers' `LanguageClassifier` / `FrameworkClassifier`, the
  Commander's command catalog + handlers, the view registry, the scanner plugins). Adding the
  next case should mean adding one struct/file/entry — not editing a `switch` in five places.
- **Keep responsibilities where they belong.** The scanner classifies/extracts, the designer
  persists and builds graphs, the gateway brokers, the renderer presents. Don't smear logic
  across layers because it's expedient — put it in the service that owns that concern.
- **No name-based / positional hacks.** Decide from real evidence (manifests, declarations,
  content, types), not from directory names, ordering, or string sniffing of UI labels.
- **Data-driven over hardcoded.** Lists, maps and registries that are easy to extend beat long
  conditionals. Co-locate each variant with its metadata so the catalog stays discoverable.
- **Design for the AI + scripting surfaces too.** New actions should be reachable as commands
  (Commander) and, where useful, as agent skills — not only wired into one button.
- **When the evidence/logic is genuinely ambiguous, escalate** (e.g. ask the AI) rather than
  guessing with a brittle heuristic.

If a proper solution needs a schema/proto change, a new abstraction, or touching several
layers, do that — don't pack data into an existing field or special-case it to avoid the work.
When in doubt, pause and confirm the design rather than churning shortcuts.

## Database writes must replace, not accumulate (stale data is a bug)

The designer is the only service with database access; it persists what the scanner produces
(projects, apps, elements, files, graph state). A re-scan must leave the DB reflecting ONLY
what currently exists on disk — never a mix of old and new rows.

So: whenever you change a service that writes to the database — or change WHAT it writes (e.g.
how apps/elements are detected or classified) — make the write path **prune the data it
previously wrote** for that scope before/while inserting the fresh results. Concretely, a
re-scan of a project must drop apps/elements that are no longer reported (not just upsert the
ones that are), so a directory that stopped being an app, a renamed element, or a reclassified
package disappears instead of lingering.

Why this matters: changing detection logic and re-running has NO visible effect if the old
rows survive — you debug "ghost" nodes that only exist in the database. Treat the scan result
as the source of truth and reconcile the DB to it (insert new, update changed, delete absent).

Reminder: the scanner and designer run as containers — code changes need the service rebuilt
(or hot-reloaded via the dev compose) AND a re-scan before they show up in the app.

## Comments in English

Write all source-code comments in English (not Polish), in every language used in this repo
(TypeScript/React, Go, etc.). This applies to new and edited code. Existing Polish comments
may stay until the surrounding code is touched; when you edit a block, translate its comments
to English as you go.

This is about the comment language only — it does not change the blank-lines-around-control-blocks
formatting rule from the global config.

## UI strings via i18n

All user-facing UI text must go through react-i18next (add keys to both `en.ts` and `pl.ts`).
Never hardcode display strings in components.

## Terminology: "maximized" editor window = "snapped to top"

In this app a **maximized** editor window means a window **snapped to the top** — it fills the
view "scene" (the area right of the file tree, below the tabs, above the agent bar), not the OS
screen and not the whole app. There is no separate maximize state; maximize == top-snap (the
`snapped`/`snappedTop` flag, `sceneFill`, `Window` top-snap, double-click the header to toggle).

A maximized (top-snapped) window must **never cover the file tree**. The snap scene
(`CodeEditor.sceneRect`) is clamped to start at the right edge of the visible file tree
(`.js-file-tree`), so a filled window always stops at the tree.
