import { describe, expect, test } from 'claude-code/testing'

import { bar, formatElapsed, formatPercent, parseOutcome, parseProgress, truncate } from '../hooks/parse'

describe('parseProgress', () => {
  test('takes the newest percent across carriage-return redraws', async () => {
    const out = 'Downloading\r 10% |##   |\r 45% |#####  |\r 73.5% |#######|'
    expect(parseProgress(out)).toEqual({ percent: 73.5, detail: '' })
  })

  test('reads bracketed steps', async () => {
    expect(parseProgress('[3/8] Linking dependencies...')).toEqual({ percent: 37.5, detail: '3/8' })
  })

  test('reads "N of M"', async () => {
    expect(parseProgress('processing file 2 of 4')?.percent).toBe(50)
  })

  test('ignores paths, versions and over-100 percents', async () => {
    expect(parseProgress('cd src/app && node v18.3/1\nload 250%')).toBeNull()
  })

  test('strips ANSI colours', async () => {
    expect(parseProgress('\u001b[32m 60%\u001b[0m done')?.percent).toBe(60)
  })
})

describe('parseOutcome', () => {
  test('jest summary', async () => {
    const out = 'PASS a.test.ts\nTests:       1 failed, 49 passed, 50 total\nTime: 3s'
    expect(parseOutcome(out)).toEqual({ percent: 98, detail: 'тесты 49/50, упало 1' })
  })

  test('pytest summary', async () => {
    expect(parseOutcome('===== 3 failed, 7 passed in 0.5s =====')?.percent).toBe(70)
  })

  test('vitest summary', async () => {
    expect(parseOutcome(' Tests  2 failed | 6 passed (8)')?.detail).toBe('тесты 6/8, упало 2')
  })

  test('coverage table', async () => {
    expect(parseOutcome('All files  |   87.5 |  80 | 90 | 87.5 |')).toEqual({
      percent: 87.5,
      detail: 'покрытие',
    })
  })

  test('a build error count is not a test result', async () => {
    expect(parseOutcome('Found 2 errors in 1 file. 3 failed builds')).toBeNull()
  })

  test('plain output has no measurable result', async () => {
    expect(parseOutcome('hello\nworld')).toBeNull()
  })
})

test('formatting', async () => {
  expect(formatElapsed(12_400)).toBe('0:12')
  expect(formatElapsed(65_000)).toBe('1:05')
  expect(bar(50, 4)).toBe('██░░')
  expect(formatPercent(37.5)).toBe('37.5%')
  expect(formatPercent(98)).toBe('98%')
  expect(truncate('abcdef', 4)).toBe('abc…')
})
