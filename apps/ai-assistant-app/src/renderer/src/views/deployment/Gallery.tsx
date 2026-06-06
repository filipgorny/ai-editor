// Gallery — the left strip of the deployment view: a palette of shapes on top and an
// arrow-style picker below it. The file tree is hidden for this view (the plan: "tree
// turns into an icon gallery"), so this gallery replaces it visually.
//
// Shapes can be either dragged onto the canvas (HTML5 drag, dataTransfer carries the
// kind) or clicked to drop one at a default position. The arrow-style buttons set which
// head style NEW connections get (and re-style the currently selected edge).

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { colors } from '../../styles/tokens'
import {
  CONNECTOR_SPECS,
  CONNECTOR_STYLES,
  DIAGRAM_CATEGORIES,
  type ArrowStyle,
  type DiagramCategory,
  type EndCap,
  type ShapeKind
} from './types'

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  width: 200px;
  flex: 0 0 200px;
  background: ${colors.panel};
  border-right: 1px solid ${colors.border};
  overflow-y: auto;
  user-select: none;
`

// Sticky search bar pinned to the very top of the gallery — find a graphic by name.
const SearchSection = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px;
  background: ${colors.panel};
  border-bottom: 1px solid ${colors.border};
`

const SearchInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  color: #e6edf3;
  font-size: 12px;

  &::placeholder {
    color: ${colors.muted};
  }

  &:focus {
    outline: none;
    border-color: var(--accent, ${colors.controller});
  }
`

const NoResults = styled.div`
  padding: 12px 8px;
  color: ${colors.muted};
  font-size: 12px;
  text-align: center;
`

const Section = styled.div`
  padding: 10px 8px;
  border-bottom: 1px solid ${colors.border};
`

const SectionTitle = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.muted};
  margin-bottom: 8px;
`

// Clickable accordion header for a category. Clicking it opens this category and rolls the
// others closed (see Gallery's openId state).
const CategoryTitle = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  margin-bottom: ${(p) => (p.$open ? '8px' : '0')};
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${(p) => (p.$open ? '#fff' : '#e6edf3')};
  transition: color 0.15s, margin-bottom 0.28s ease;

  &:hover {
    color: #fff;
  }
`

// The caret rotates from ▸ (closed) to ▾ (open).
const Caret = styled.span<{ $open: boolean }>`
  display: inline-block;
  transition: transform 0.28s ease;
  transform: rotate(${(p) => (p.$open ? '90deg' : '0deg')});
`

// Wraps a category's shapes; rolls up (max-height → 0) when the category is closed.
const ShapeList = styled.div<{ $open: boolean }>`
  overflow: hidden;
  max-height: ${(p) => (p.$open ? '1200px' : '0')};
  opacity: ${(p) => (p.$open ? 1 : 0)};
  transition: max-height 0.3s ease, opacity 0.2s ease;
`

const ShapeButton = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 4px;
  margin-bottom: 6px;
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  color: #e6edf3;
  cursor: grab;
  font-size: 11px;

  &:hover {
    border-color: var(--accent, ${colors.controller});
    color: #fff;
  }

  &:active {
    cursor: grabbing;
  }
`

const ArrowButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: ${(p) => (p.$active ? 'var(--accent, #58a6ff)' : colors.bg)};
  border: 1px solid ${(p) => (p.$active ? 'var(--accent, #58a6ff)' : colors.border)};
  border-radius: 6px;
  color: ${(p) => (p.$active ? 'var(--accent-contrast, #fff)' : '#e6edf3')};
  cursor: pointer;
  font-size: 11px;

  &:hover {
    color: ${(p) => (p.$active ? 'var(--accent-contrast, #fff)' : '#fff')};
  }

  svg {
    flex: 0 0 auto;
  }
`

// The svg icon for a shape, scaled to fit the button. Loaded from public/shapes/<cat>/<name>.svg.
const PreviewImg = styled.img`
  width: 40px;
  height: 30px;
  object-fit: contain;
  pointer-events: none;
`

// Shape name shown under its icon in the gallery button.
const ShapeName = styled.span`
  text-align: center;
  line-height: 1.2;
  word-break: break-word;
`

function ShapePreview({ category, name }: { category: string; name: string }): React.JSX.Element {
  return <PreviewImg src={`/shapes/${category}/${name}.svg`} alt={name} />
}

// Connector previews are drawn with fixed geometry (no markers) so each end cap — arrow,
// crow's foot ("kurza stopka"), or ER bar — reads clearly at this small size. The end cap
// sits on the right (target), the start cap on the left (source).
function endCapGlyph(cap: EndCap): React.JSX.Element | null {
  if (cap === 'arrow') {
    return <polygon points="33,7 25,3 25,11" fill="#fff" stroke="#fff" />
  }

  if (cap === 'arrowEmpty') {
    return <polygon points="33,7 25,3 25,11" fill="none" stroke="#fff" strokeWidth={1.2} />
  }

  if (cap === 'crow') {
    return <path d="M24,7 L33,2 M24,7 L33,7 M24,7 L33,12" fill="none" stroke="#fff" strokeWidth={1.2} />
  }

  if (cap === 'bar') {
    return <line x1={26} y1={2} x2={26} y2={12} stroke="#fff" strokeWidth={1.6} />
  }

  return null
}

function startCapGlyph(cap: EndCap): React.JSX.Element | null {
  if (cap === 'arrow') {
    return <polygon points="1,7 9,3 9,11" fill="#fff" stroke="#fff" />
  }

  if (cap === 'arrowEmpty') {
    return <polygon points="1,7 9,3 9,11" fill="none" stroke="#fff" strokeWidth={1.2} />
  }

  if (cap === 'crow') {
    return <path d="M10,7 L1,2 M10,7 L1,7 M10,7 L1,12" fill="none" stroke="#fff" strokeWidth={1.2} />
  }

  if (cap === 'bar') {
    return <line x1={8} y1={2} x2={8} y2={12} stroke="#fff" strokeWidth={1.6} />
  }

  return null
}

function ConnectorPreview({ style }: { style: ArrowStyle }): React.JSX.Element {
  const spec = CONNECTOR_SPECS[style] ?? CONNECTOR_SPECS.solid

  return (
    <svg width={34} height={14} viewBox="0 0 34 14">
      <line
        x1={6}
        y1={7}
        x2={28}
        y2={7}
        stroke="#fff"
        strokeWidth={1.4}
        strokeDasharray={spec.dashed ? '4 3' : undefined}
      />
      {startCapGlyph(spec.start)}
      {endCapGlyph(spec.end)}
    </svg>
  )
}

export interface GalleryProps {
  arrow: ArrowStyle
  onArrowChange: (a: ArrowStyle) => void
  onAddShape: (kind: ShapeKind) => void
}

// DiagramElementsCategory — one gallery group: a clickable name as the accordion header,
// then its shapes (draggable/clickable buttons) that roll up when the group is closed.
// Generic over the category, so the same component renders the basic primitives and the AWS
// "Deployment" icons alike.
function DiagramElementsCategory({
  category,
  shapes,
  open,
  onToggle,
  onAddShape
}: {
  category: DiagramCategory
  shapes: string[]
  open: boolean
  onToggle: () => void
  onAddShape: (kind: ShapeKind) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Section>
      <CategoryTitle $open={open} onClick={onToggle} aria-expanded={open}>
        <span>{t(category.titleKey)}</span>
        <Caret $open={open}>▸</Caret>
      </CategoryTitle>

      <ShapeList $open={open} aria-hidden={!open}>
        {shapes.map((name) => {
          const kind = `${category.id}/${name}`

          return (
            <ShapeButton
              key={kind}
              draggable
              tabIndex={open ? 0 : -1}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/deployment-shape', kind)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onAddShape(kind)}
              title={t(`deployment.shape.${name}`)}
            >
              <ShapePreview category={category.id} name={name} />
              <ShapeName>{t(`deployment.shape.${name}`)}</ShapeName>
            </ShapeButton>
          )
        })}
      </ShapeList>
    </Section>
  )
}

export function Gallery({ arrow, onArrowChange, onAddShape }: GalleryProps): React.JSX.Element {
  const { t } = useTranslation()

  // Accordion: exactly one category open at a time, the first ('Basic') by default — so the
  // 'Deployment' group starts rolled up. Clicking a header opens it and closes the rest.
  const [openId, setOpenId] = useState<string>(DIAGRAM_CATEGORIES[0]?.id ?? '')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // For each category, the shape names visible under the current search. While searching,
  // a graphic matches on its raw id or its translated name; categories with no match are
  // dropped entirely and every surviving category is forced open.
  const groups = DIAGRAM_CATEGORIES.map((category) => ({
    category,
    shapes: category.shapes.filter(
      (name) =>
        !searching ||
        name.toLowerCase().includes(q) ||
        t(`deployment.shape.${name}`).toLowerCase().includes(q)
    )
  })).filter((g) => !searching || g.shapes.length > 0)

  return (
    <Panel>
      <SearchSection>
        <SearchInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('deployment.search')}
          aria-label={t('deployment.search')}
        />
      </SearchSection>

      {groups.map(({ category, shapes }) => (
        <DiagramElementsCategory
          key={category.id}
          category={category}
          shapes={shapes}
          open={searching || openId === category.id}
          onToggle={() => setOpenId(category.id)}
          onAddShape={onAddShape}
        />
      ))}

      {searching && groups.length === 0 ? <NoResults>{t('deployment.noResults')}</NoResults> : null}

      <Section>
        <SectionTitle>{t('deployment.connectors')}</SectionTitle>

        {CONNECTOR_STYLES.map((style) => (
          <ArrowButton
            key={style}
            $active={arrow === style}
            onClick={() => onArrowChange(style)}
            title={t(`deployment.connector.${style}`)}
          >
            <ConnectorPreview style={style} />
            {t(`deployment.connector.${style}`)}
          </ArrowButton>
        ))}
      </Section>
    </Panel>
  )
}
