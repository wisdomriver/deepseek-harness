// StatusCard: centered icon, title, description, and up to two actions for the
// loading, unavailable, permission, or error state a panel shows in place of
// its content. Every string arrives through props; the card reads no locale.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from './Button.tsx'
import css from './StatusCard.module.css'

/** One action of a {@link StatusCard}. */
export interface StatusCardAction {
  /** Localized button text. */
  label: string
  /** Activation command. */
  onClick: () => void
}

/** Props for {@link StatusCard}. */
export interface StatusCardProps {
  /** Optional state glyph, drawn in the tone color; it is aria-hidden, so `title` carries the name. */
  icon?: ReactNode
  /** Localized headline naming the state. */
  title: ReactNode
  /** Optional localized sentence explaining the state or the next step. */
  description?: ReactNode
  /** Optional primary action, rendered as a `primary` button. */
  primaryAction?: StatusCardAction
  /** Optional secondary action, rendered as a `ghost` button. */
  secondaryAction?: StatusCardAction
  /** `danger` colors the glyph with the error-state color; defaults to `neutral`. */
  tone?: 'neutral' | 'danger'
  /** Optional class for layout placement; a CSS-module lookup may be undefined. */
  className?: string | undefined
}

/**
 * Render a state card.
 * @param props.icon - optional state glyph; it is aria-hidden and inherits the tone color.
 * @param props.title - headline naming the state.
 * @param props.description - optional supporting sentence.
 * @param props.primaryAction - optional action rendered as the primary button.
 * @param props.secondaryAction - optional action rendered as the ghost button.
 * @param props.tone - `danger` colors the glyph and sets `data-tone="danger"`; defaults to `neutral`.
 * @param props.className - extra class for the card element.
 * @returns the card element, which carries no surface or width of its own.
 */
export function StatusCard({
  icon, title, description, primaryAction, secondaryAction, tone = 'neutral', className,
}: StatusCardProps) {
  const actions = primaryAction != null || secondaryAction != null
  return (
    <div className={clsx(css.card, tone === 'danger' && css.danger, className)} data-tone={tone}>
      {icon != null && <div className={css.icon} aria-hidden="true">{icon}</div>}
      <div className={css.text}>
        <div className={css.title}>{title}</div>
        {description != null && <div className={css.description}>{description}</div>}
      </div>
      {actions && (
        <div className={css.actions}>
          {primaryAction != null && (
            <Button variant="primary" onClick={primaryAction.onClick}>{primaryAction.label}</Button>
          )}
          {secondaryAction != null && (
            <Button variant="ghost" onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
          )}
        </div>
      )}
    </div>
  )
}
