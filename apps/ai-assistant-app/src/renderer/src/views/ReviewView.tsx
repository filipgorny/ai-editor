// ReviewView — the review-mode dashboard (ViewKey 'review').
//
// Review mode (plan item 5) layers three things onto the IDE:
//   1. the file tree shows ONLY changed files — owned by the FileBrowser agent, which
//      reads the same GitContext review status this view drives; this view does not touch
//      the tree, it only coordinates through the shared git review state.
//   2. in the editor, ADDED lines get a green line number and EDITED lines a yellow one —
//      owned by the reviewDecoration extension (already wired into CodeEditor); this view
//      just opens files there so the coloring shows.
//   3. AI comment bubbles next to code, but ONLY on lines that were changed — owned HERE:
//      this view requests an AI review per changed file, clamps the comments to the diff's
//      changed lines, and lists them as bubbles. Clicking a bubble opens the file at that
//      line, where CodeEditor renders the same comment inline (it already merges aiReview
//      remarks into the ghost layer).
//
// Follows the view contract: imports ONLY ./types (+ tokens/extensions it co-owns), and
// reaches the bus/api through ctx — never App, the registry, or sibling views.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { ViewContext } from './types'
import { colors } from '../styles/tokens'
import { reviewAddedColor, reviewModifiedColor } from '../components/reviewDecoration'
import { filterToChangedLines, reviewBubbleColor, type Remark } from '../components/reviewGhost'

// One reviewed file: its diff (changed lines) plus the AI comments clamped to them.
type FileReview = {
  path: string
  absPath: string
  status: string
  added: number[]
  modified: number[]
  comments: Remark[]
  loading: boolean
  error?: boolean
}

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${colors.bg};
  color: #e6edf3;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid ${colors.border};
`

const Title = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
`

const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
  font-size: 12px;
  color: ${colors.muted};
`

const Swatch = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: ${(p) => p.$color};
  }
`

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${colors.border};
    border-radius: 6px;
  }
`

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.muted};
  font-size: 14px;
`

const FileCard = styled.div`
  border: 1px solid ${colors.border};
  border-radius: 10px;
  overflow: hidden;
  background: #11161d;
`

const FileHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid ${colors.border};

  &:hover {
    background: #161c25;
  }
`

const StatusDot = styled.span<{ $status: string }>`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  background: ${(p) =>
    p.$status === 'new'
      ? reviewAddedColor
      : p.$status === 'deleted'
        ? colors.danger
        : reviewModifiedColor};
`

const FilePath = styled.span`
  font-family: 'Hack', monospace;
  font-size: 13px;
  color: #e6edf3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StatusTag = styled.span`
  font-size: 11px;
  color: ${colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`

const Spacer = styled.span`
  margin-left: auto;
`

const ActionBtn = styled.button`
  border: 1px solid ${colors.border};
  background: transparent;
  color: ${colors.muted};
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    color: #e6edf3;
    border-color: ${reviewBubbleColor};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

const Comments = styled.div`
  padding: 8px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

// Bubble — an AI review comment, styled as a speech bubble with a small tail, colored to
// match the inline editor bubble. Clicking it opens the file at the commented line.
const Bubble = styled.div`
  position: relative;
  align-self: flex-start;
  max-width: 92%;
  margin-left: 14px;
  background: #1d2530;
  border: 1px solid ${reviewBubbleColor};
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.45;
  color: #e6edf3;
  cursor: pointer;

  &:hover {
    background: #232c39;
  }

  &::before {
    content: '';
    position: absolute;
    left: -7px;
    top: 12px;
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-right: 7px solid ${reviewBubbleColor};
  }
`

const LineTag = styled.span`
  font-family: 'Hack', monospace;
  font-size: 11px;
  color: ${reviewBubbleColor};
  margin-right: 8px;
`

const NoComments = styled.div`
  padding: 4px 14px 12px;
  font-size: 12px;
  color: ${colors.muted};
`

export default function ReviewView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const { api, folder, reviewFiles, review, navKey, openFile } = ctx

  const [files, setFiles] = useState<FileReview[]>([])

  // Seed the file list from the shared review status (same source the file tree reads).
  // Text files only — a binary/deleted file has no reviewable lines.
  useEffect(() => {
    const seeded: FileReview[] = reviewFiles
      .filter((f) => f.status !== 'deleted')
      .map((f) => ({
        path: f.path,
        absPath: f.absPath,
        status: f.status,
        added: [],
        modified: [],
        comments: [],
        loading: false
      }))

    setFiles(seeded)
  }, [reviewFiles, navKey])

  // requestReview pulls the diff (changed lines) and an AI review for one file, then keeps
  // ONLY the comments anchored to changed lines — that "changed lines only" clamp is the
  // heart of the feature. The AI sees the whole file (so it has context) but its remarks
  // are filtered down to the diff before they reach the UI / editor.
  const requestReview = useCallback(
    async (absPath: string): Promise<void> => {
      setFiles((prev) =>
        prev.map((f) => (f.absPath === absPath ? { ...f, loading: true, error: false } : f))
      )

      try {
        const [diff, code] = await Promise.all([
          api.gitFileDiff(folder, absPath).catch(() => null),
          api.readFile(absPath).catch(() => '')
        ])

        const added = diff?.addedLines ?? []
        const modified = diff?.modifiedLines ?? []

        const raw = await api.aiReview(code, absPath, langOf(absPath)).catch(() => [])

        const remarks: Remark[] = raw.map((r) => ({
          line: r.line,
          text: r.text,
          color: reviewBubbleColor,
          prefix: '\u{1F4AC}'
        }))

        // Keep comments only where something actually changed.
        const comments = filterToChangedLines(remarks, { added, modified })

        setFiles((prev) =>
          prev.map((f) =>
            f.absPath === absPath ? { ...f, added, modified, comments, loading: false } : f
          )
        )
      } catch {
        setFiles((prev) =>
          prev.map((f) => (f.absPath === absPath ? { ...f, loading: false, error: true } : f))
        )
      }
    },
    [api, folder]
  )

  // Total comment count for the header badge.
  const total = useMemo(() => files.reduce((n, f) => n + f.comments.length, 0), [files])

  // Open the file at a commented line; the editor then shows the colored gutter + inline
  // bubble for that exact line.
  const openAt = useCallback(
    (absPath: string, line: number): void => {
      openFile(absPath, undefined, true, line)
    },
    [openFile]
  )

  if (!review) {
    return (
      <Wrap>
        <Empty>{t('review.notActive')}</Empty>
      </Wrap>
    )
  }

  if (!folder) {
    return (
      <Wrap>
        <Empty>{t('review.noProject')}</Empty>
      </Wrap>
    )
  }

  return (
    <Wrap>
      <Header>
        <Title>{t('review.changedFiles', { count: files.length })}</Title>

        <Legend>
          <Swatch $color={reviewAddedColor}>{t('review.legend.added')}</Swatch>

          <Swatch $color={reviewModifiedColor}>{t('review.legend.modified')}</Swatch>

          <span>{t('review.commentCount', { count: total })}</span>
        </Legend>
      </Header>

      {files.length === 0 ? (
        <Empty>{t('review.noChanges')}</Empty>
      ) : (
        <Scroll>
          {files.map((f) => (
            <FileCard key={f.absPath}>
              <FileHead onClick={() => openAt(f.absPath, f.added[0] ?? f.modified[0] ?? 1)}>
                <StatusDot $status={f.status} />

                <FilePath title={f.path}>{f.path}</FilePath>

                <StatusTag>{t(`review.status.${f.status}`)}</StatusTag>

                <Spacer />

                <ActionBtn
                  disabled={f.loading}
                  onClick={(e) => {
                    e.stopPropagation()
                    requestReview(f.absPath)
                  }}
                >
                  {f.loading ? t('review.reviewing') : t('review.askAi')}
                </ActionBtn>
              </FileHead>

              {f.comments.length > 0 && (
                <Comments>
                  {f.comments.map((c, i) => (
                    <Bubble key={i} onClick={() => openAt(f.absPath, c.line)}>
                      <LineTag>{t('review.lineLabel', { line: c.line })}</LineTag>

                      {c.text}
                    </Bubble>
                  ))}
                </Comments>
              )}

              {f.error && <NoComments>{t('review.reviewFailed')}</NoComments>}

              {!f.error &&
                !f.loading &&
                f.comments.length === 0 &&
                f.added.length + f.modified.length > 0 && (
                  <NoComments>{t('review.noComments')}</NoComments>
                )}
            </FileCard>
          ))}
        </Scroll>
      )}
    </Wrap>
  )
}

// langOf derives a coarse language hint from the file extension for aiReview.
function langOf(file: string): string {
  const ext = (file.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    go: 'go',
    py: 'python',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    css: 'css',
    scss: 'scss',
    html: 'html'
  }

  return map[ext] || ext || 'text'
}
