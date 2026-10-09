/** What a measurable result is besides its percent; the band words it in the chosen language. */
export type Detail =
  | { kind: 'steps'; done: number; total: number }
  | { kind: 'tests'; passed: number; total: number; failed: number }
  | { kind: 'coverage' }

export type Run = {
  id: string
  label: string
  startedAt: number
  /** When the row was last polled: the elapsed time and ETA are read against it. */
  updatedAt: number
  /** When the percent or the detail last changed, for the stall mark. */
  changedAt: number
  percent: number | null
  /** A string only on rows an older version stored. */
  detail: Detail | string | null
  /** The first percent seen and when, for the ETA. */
  firstPercent: number | null
  firstAt: number | null
  /** The output file the row is read from, once known. */
  file: string | null
  /** The background task id, while the command runs in the background. */
  taskId: string | null
  isDone: boolean
  isFailed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'shell-progress': { runs: Run[] }
  }
}
