import { AppNode } from './AppNode'
import { NodeKind } from './Node'

// PackageNode to paczka TypeScript w monorepo (np. packages/*) — biblioteka, nie aplikacja.
// Dziedziczy po AppNode (ma appId), więc drill-down do wnętrza działa tak samo jak dla
// aplikacji; różni się tylko rodzajem (kolor/ikona dla paczki TS).
export class PackageNode extends AppNode {
  get kind(): NodeKind {
    return 'package'
  }
}
