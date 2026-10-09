// What one band row says, from a Run alone: no `$`, so the tests cover it directly.

import type { Run } from '../types'
import { formatElapsed, formatPercent } from './parse'

/** Remaining time by the average rate since the first percent seen; null until it can tell. */
export function etaOf(run: Run): number | null {
  if (run.isDone || run.percent === null || run.firstPercent === null || run.firstAt === null) {
    return null
  }
  const gained = run.percent - run.firstPercent
  const spent = run.updatedAt - run.firstAt
  if (gained <= 0 || spent < 2000 || run.percent >= 100) {
    return null
  }

  return ((100 - run.percent) * spent) / gained
}

/** How long the progress has stood still, when it has for at least `stallMs`; else null. */
export function stalledFor(run: Run, stallMs: number): number | null {
  if (run.isDone || stallMs <= 0) {
    return null
  }
  const still = run.updatedAt - run.changedAt

  return still >= stallMs ? still : null
}

export const ETA_WIDTH = 10

/** The fixed-width columns between the bar and the description. */
export function columnsOf(run: Run, stallMs: number, detailWidth: number): string {
  const stall = stalledFor(run, stallMs)
  const eta = etaOf(run)
  const hint =
    stall !== null ? `стоит ${formatElapsed(stall)}` : eta !== null ? `~${formatElapsed(eta)}` : ''

  return (
    ` ${formatPercent(run.percent ?? 0).padStart(6)}` +
    ` ${formatElapsed(run.updatedAt - run.startedAt).padStart(5)}` +
    ` ${hint.padEnd(ETA_WIDTH)}` +
    (detailWidth > 0 ? ` ${(run.detail ?? '').padEnd(detailWidth)}` : '')
  )
}

/** The one-line summary a notification carries. */
export function summaryOf(run: Run): string {
  const parts = [
    formatPercent(run.percent ?? 0),
    run.detail || null,
    formatElapsed(run.updatedAt - run.startedAt),
  ].filter(part => part !== null)

  return `${run.isFailed ? '✗' : '✓'} ${run.label} · ${parts.join(' · ')}`
}
