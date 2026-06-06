// Gallery — the left strip of the deployment view: a palette of shapes on top and an
// arrow-style picker below it. The file tree is hidden for this view (the plan: "tree
// turns into an icon gallery"), so this gallery replaces it visually.
//
// Shapes can be either dragged onto the canvas (HTML5 drag, dataTransfer carries the
// kind) or clicked to drop one at a default position. The arrow-style buttons set which
// head style NEW connections get (and re-style the currently selected edge).

import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { colors } from '../../styles/tokens'
import type { ArrowStyle, ShapeKind } from './types'

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  width: 132px;
  flex: 0 0 132px;
  background: ${colors.panel};
  border-right: 1px solid ${colors.border};
  overflow-y: auto;
  user-select: none;
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
  color: ${colors.muted};
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
  color: ${(p) => (p.$active ? '#000' : colors.muted)};
  cursor: pointer;
  font-size: 11px;

  &:hover {
    color: ${(p) => (p.$active ? '#000' : '#fff')};
  }

  svg {
    flex: 0 0 auto;
  }
`

function ShapePreview({ category, name }: { category: string, name: string }): React.JSX.Element {
  return <>
    <img src={`/shapes/${category}/${name}.svg`}/>
  </>
}

// Tiny arrow-style previews drawn with the same marker idea used on the canvas.
function ArrowPreview({ style }: { style: ArrowStyle }): React.JSX.Element {
  const head = (id: string, hollow: boolean, flip: boolean): React.JSX.Element => (
    <marker
      id={id}
      markerWidth={10}
      markerHeight={10}
      refX={flip ? 1 : 8}
      refY={4}
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path
        d={flip ? 'M8,0 L0,4 L8,8 Z' : 'M0,0 L8,4 L0,8 Z'}
        fill={hollow ? '#fff' : '#fff'}
        stroke="#fff"
        strokeWidth={1}
      />
    </marker>
  )

  const sid = `gp-${style}`

  return (
    <svg width={30} height={10} viewBox="0 0 30 10">
      <defs>
        {style !== 'none' && head(`${sid}-e`, style === 'empty', false)}
        {style === 'both' && head(`${sid}-s`, false, true)}
      </defs>
      <line
        x1={2}
        y1={5}
        x2={28}
        y2={5}
        stroke="#fff"
        strokeWidth={1.4}
        markerEnd={style !== 'none' ? `url(#${sid}-e)` : undefined}
        markerStart={style === 'both' ? `url(#${sid}-s)` : undefined}
      />
    </svg>
  )
}

export interface GalleryProps {
  arrow: ArrowStyle
  onArrowChange: (a: ArrowStyle) => void
  onAddShape: (kind: ShapeKind) => void
}

const SHAPES = {
  "amazon": ["documentdb", "ec2", "ecs", "rds", "redshift", "s3"],
  "basic": ["rectangle", "cloud", "database"]
}

const ARROWS: ArrowStyle[] = ['solid', 'empty', 'none', 'both']

export function Gallery({ arrow, onArrowChange, onAddShape }: GalleryProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Panel>
      <Section>
        <SectionTitle>{t('deployment.shapes')}</SectionTitle>

        {Object.keys(SHAPES).map((shapeCategory, index) => SHAPES[shapeCategory].map((shapeName: string) => (
          <ShapeButton
            key={index}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/deployment-shape', shapeName)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAddShape(shapeName)}
            title={t(`deployment.shape.${shapeName}`)}
          >
            <ShapePreview category={shapeCategory} name={shapeName} />
            {t(`deployment.shape.${shapeName}`)}
          </ShapeButton>
        )))}
      </Section>

      <Section>
        <SectionTitle>{t('deployment.arrows')}</SectionTitle>

        {ARROWS.map((style) => (
          <ArrowButton
            key={style}
            $active={arrow === style}
            onClick={() => onArrowChange(style)}
            title={t(`deployment.arrow.${style}`)}
          >
            <ArrowPreview style={style} />
            {t(`deployment.arrow.${style}`)}
          </ArrowButton>
        ))}
      </Section>
    </Panel>
  )
}
