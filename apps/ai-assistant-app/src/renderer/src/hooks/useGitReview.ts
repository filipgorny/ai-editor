import { useEffect, useMemo, useState } from 'react'
import { appBus } from '../events'
import { type GitState, type BlameMode, type ReviewStatus } from '@/common/GitContext'
import type { ViewKey } from '../views/types'

export function useGitReview(folder: string, activeView: ViewKey, gitBlame: BlameMode) {
  // tryb review: zmienione pliki (gałąź vs baza) ze statusem
  const [review, setReview] = useState(false)
  const [reviewFiles, setReviewFiles] = useState<{ path: string; absPath: string; status: ReviewStatus }[]>([])
  // git: czy kopia .git jest już wgrana
  const [gitReady, setGitReady] = useState(false)

  // Serwis git czyta repozytorium WPROST z dysku (widzi też niezacommitowane
  // zmiany w drzewie roboczym), więc nic nie wysyłamy — gotowość zależy tylko od
  // tego, czy jest otwarty projekt.
  useEffect(() => {
    setGitReady(!!folder)
  }, [folder])

  // Review mode is driven AUTOMATICALLY by the active view: entering the 'review' tab
  // turns it on (loading the changed-files list from git), leaving it turns it off. There
  // is no manual toggle button — the view IS the switch.
  useEffect(() => {
    const onReview = activeView === 'review'

    if (!onReview) {
      // Leaving the review tab → turn review off and clear its file list.
      if (review) {
        setReview(false)
        setReviewFiles([])
        appBus.emit('review:toggle', { on: false })
      }

      return
    }

    if (!folder) {
      return
    }

    let cancelled = false

    window.api
      .gitReview(folder)
      .catch(() => null)
      .then((res) => {
        if (cancelled) {
          return
        }

        const files = (res?.files ?? []).map((f) => ({
          path: f.path,
          absPath: f.absPath,
          status: f.status as ReviewStatus
        }))

        setReviewFiles(files)
        setReview(true)
        appBus.emit('review:toggle', { on: true, count: files.length })
      })

    return () => {
      cancelled = true
    }
    // review intentionally omitted: this effect SETS it; including it would re-run the
    // gitReview fetch every time review flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, folder])

  // Mapa abs. ścieżka → status (dla klocków grafu w trybie review).
  const reviewStatus = useMemo(() => {
    const m: Record<string, ReviewStatus> = {}

    for (const f of reviewFiles) {
      m[f.absPath] = f.status
    }

    return m
  }, [reviewFiles])

  // Wartość kontekstu gita dla klocków/edytora. blame bramkowany przez gitReady,
  // by nie odpytywać serwisu przed wgraniem kopii .git.
  const gitState: GitState = useMemo(
    () => ({
      repoRoot: folder,
      blame: gitReady ? gitBlame : 'off',
      review,
      statusByAbs: reviewStatus
    }),
    [folder, gitReady, gitBlame, review, reviewStatus]
  )

  return { review, reviewFiles, gitState, reviewStatus }
}
