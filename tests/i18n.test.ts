import { expect, test } from 'claude-code/testing'

import { LANGUAGES, STRINGS, detailText, languageOf } from '../hooks/i18n'

test('languageOf: an explicit choice wins over the locale', async () => {
  expect(languageOf('de', ['ru_RU.UTF-8'])).toBe('de')
})

test('languageOf: auto takes the first set locale, skipping C', async () => {
  expect(languageOf('auto', [undefined, 'C', 'fr_FR.UTF-8'])).toBe('fr')
  expect(languageOf(undefined, ['es_ES'])).toBe('es')
})

test('languageOf: unknown or missing falls back to English', async () => {
  expect(languageOf('auto', ['ja_JP.UTF-8'])).toBe('en')
  expect(languageOf('auto', [])).toBe('en')
  expect(languageOf('xx', [])).toBe('en')
})

test('every language words every detail kind', async () => {
  for (const language of LANGUAGES) {
    const t = STRINGS[language]
    expect(detailText({ kind: 'steps', done: 3, total: 8 }, t)).toBe('3/8')
    expect(detailText({ kind: 'tests', passed: 49, total: 50, failed: 1 }, t)).toMatch(/49\/50.*1/)
    expect(detailText({ kind: 'tests', passed: 50, total: 50, failed: 0 }, t)).not.toContain(',')
    expect(detailText({ kind: 'coverage' }, t).length).toBeGreaterThan(0)
    expect(t.cleared(2)).toContain('2')
  }
})

test('a detail stored as text by an older version shows as it was', async () => {
  expect(detailText('тесты 1/2', STRINGS.en)).toBe('тесты 1/2')
})
