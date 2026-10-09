// The words the band, the command and the notification use, per language.

import type { Detail } from '../types'

export const LANGUAGES = ['en', 'ru', 'de', 'es', 'fr'] as const
export type Language = (typeof LANGUAGES)[number]

export type Strings = {
  /** Before the stalled time: `stalled 0:35`. */
  stalled: string
  tests: (passed: number, total: number, failed: number) => string
  coverage: string
  clearFinished: string
  commandDescription: string
  nothingToClear: string
  cleared: (count: number) => string
}

export const STRINGS: Record<Language, Strings> = {
  en: {
    stalled: 'stalled',
    tests: (passed, total, failed) =>
      `tests ${passed}/${total}${failed > 0 ? `, ${failed} failed` : ''}`,
    coverage: 'coverage',
    clearFinished: 'Clear finished',
    commandDescription: 'Clear finished progress rows',
    nothingToClear: 'No finished rows to clear.',
    cleared: count => `Cleared ${count} ${count === 1 ? 'row' : 'rows'}.`,
  },
  ru: {
    stalled: 'стоит',
    tests: (passed, total, failed) =>
      `тесты ${passed}/${total}${failed > 0 ? `, упало ${failed}` : ''}`,
    coverage: 'покрытие',
    clearFinished: 'Убрать завершённые',
    commandDescription: 'Убрать завершённые строки прогресса',
    nothingToClear: 'Нет завершённых задач для очистки.',
    cleared: count => `Убрано строк: ${count}.`,
  },
  de: {
    stalled: 'steht',
    tests: (passed, total, failed) =>
      `Tests ${passed}/${total}${failed > 0 ? `, ${failed} fehlgeschlagen` : ''}`,
    coverage: 'Abdeckung',
    clearFinished: 'Erledigte entfernen',
    commandDescription: 'Erledigte Fortschrittszeilen entfernen',
    nothingToClear: 'Keine erledigten Zeilen zum Entfernen.',
    cleared: count => `${count} ${count === 1 ? 'Zeile' : 'Zeilen'} entfernt.`,
  },
  es: {
    stalled: 'parado',
    tests: (passed, total, failed) =>
      `pruebas ${passed}/${total}${failed > 0 ? `, ${failed} fallidas` : ''}`,
    coverage: 'cobertura',
    clearFinished: 'Quitar terminadas',
    commandDescription: 'Quitar las filas de progreso terminadas',
    nothingToClear: 'No hay filas terminadas que quitar.',
    cleared: count => `${count} ${count === 1 ? 'fila quitada' : 'filas quitadas'}.`,
  },
  fr: {
    stalled: 'bloqué',
    tests: (passed, total, failed) =>
      `tests ${passed}/${total}${failed > 0 ? `, ${failed} en échec` : ''}`,
    coverage: 'couverture',
    clearFinished: 'Effacer les terminées',
    commandDescription: 'Effacer les lignes de progression terminées',
    nothingToClear: 'Aucune ligne terminée à effacer.',
    cleared: count => `${count} ${count === 1 ? 'ligne effacée' : 'lignes effacées'}.`,
  },
}

/** `auto` follows the locale (`ru_RU.UTF-8` → ru); a language not listed falls back to English. */
export function languageOf(choice: unknown, locales: readonly (string | undefined)[]): Language {
  const wanted =
    typeof choice === 'string' && choice !== 'auto'
      ? choice
      : (locales.find(locale => locale !== undefined && locale !== '' && locale !== 'C') ?? '')
  const code = wanted.slice(0, 2).toLowerCase()

  return (LANGUAGES as readonly string[]).includes(code) ? (code as Language) : 'en'
}

export function detailText(detail: Detail | string | null, t: Strings): string {
  if (detail === null) {
    return ''
  }
  if (typeof detail === 'string') {
    return detail
  }
  switch (detail.kind) {
    case 'steps':
      return `${detail.done}/${detail.total}`
    case 'tests':
      return t.tests(detail.passed, detail.total, detail.failed)
    case 'coverage':
      return t.coverage
  }
}
