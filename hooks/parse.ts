// Pure parsing of shell output: no `$`, so the tests cover it directly.

import type { Detail } from '../types'

export type Measure = { percent: number; detail: Detail | null }

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g
const PERCENT = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%/g
const BRACKETED = /[[(]\s*(\d+)\s*\/\s*(\d+)\s*[\])]/
const RATIO = /(?<![\w/.:-])(\d+)\s*(?:\/|\bof\b)\s*(\d+)(?![\w/.:-])/

const TAIL = 8_000
const LINES = 40

function lines(text: string): string[] {
  return text
    .slice(-TAIL)
    .replace(ANSI, '')
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function ratioOf(line: string): Measure | null {
  const found = line.match(BRACKETED) ?? line.match(RATIO)
  if (!found) {
    return null
  }
  const done = Number(found[1])
  const total = Number(found[2])
  if (total < 2 || done > total) {
    return null
  }

  return { percent: round((done / total) * 100), detail: { kind: 'steps', done, total } }
}

function percentOf(line: string): Measure | null {
  const values = [...line.matchAll(PERCENT)]
    .map(found => Number(found[1]))
    .filter(n => n <= 100)
  const last = values.at(-1)
  if (last === undefined) {
    return null
  }
  const ratio = ratioOf(line)

  return { percent: round(last), detail: ratio?.detail ?? null }
}

/** The live progress the newest lines of the output report, if any. */
export function parseProgress(text: string): Measure | null {
  const recent = lines(text).slice(-LINES).reverse()
  for (const line of recent) {
    const found = percentOf(line) ?? ratioOf(line)
    if (found) {
      return found
    }
  }

  return null
}

function count(line: string, words: string): number {
  const found = line.match(new RegExp(`(\\d+)\\s+(?:${words})\\b`, 'i'))

  return found ? Number(found[1]) : 0
}

/** Pass rate of a test run, from the summary line jest, vitest, pytest, mocha and cargo print. */
export function parseTests(text: string): Measure | null {
  const recent = lines(text).slice(-200).reverse()
  for (const line of recent) {
    const passed = count(line, 'passed|passing|pass')
    const failed = count(line, 'failed|failing|fail')
    const isTestLine = passed > 0 || /\b(tests?|specs?)\b/i.test(line)
    if ((passed === 0 && failed === 0) || !isTestLine) {
      continue
    }
    const stated = line.match(/(\d+)\s+total\b/i) ?? line.match(/\((\d+)\)\s*$/)
    const total = stated ? Number(stated[1]) : passed + failed
    if (total === 0) {
      continue
    }

    return {
      percent: round((passed / total) * 100),
      detail: { kind: 'tests', passed, total, failed },
    }
  }

  return null
}

/** Line coverage from an istanbul/jest/vitest table or a coverage.py TOTAL row. */
export function parseCoverage(text: string): Measure | null {
  const all = lines(text)
  for (const line of [...all].reverse()) {
    const found =
      line.match(/^All files\s*\|\s*([\d.]+)/) ?? line.match(/^TOTAL\b.*?\s(\d{1,3}(?:\.\d+)?)%$/)
    if (found) {
      return { percent: round(Number(found[1])), detail: { kind: 'coverage' } }
    }
  }

  return null
}

/** The measurable result of a finished command: tests first, then coverage, then the last progress. */
export function parseOutcome(text: string): Measure | null {
  return parseTests(text) ?? parseCoverage(text) ?? parseProgress(text)
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60

  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`
}

export function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

export function bar(percent: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
