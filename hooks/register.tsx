import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Run } from '../types'
import { bar, parseOutcome, parseProgress, truncate } from './parse'
import { ETA_WIDTH, columnsOf, summaryOf } from './row'

const runs = atom({ plugin: 'shell-progress', key: 'runs' } as const, [])

const COMMAND = 'shell-progress'
const POLL_MS = 1000
// $.fs.read rejects past 4 MiB; a bigger log keeps its last reading.
const MAX_READ = 3_500_000
// How long a starting command may take to show its output file.
const CLAIM_WAIT_MS = 2000
const CLAIM_STEP_MS = 50

const GUIDANCE = `# Measurable progress for shell commands

The person sees a live progress bar with percent, elapsed and remaining time for every Bash command whose output reports measurable progress, background commands included. It reads the command's output for a percent (\`45%\`), a step count (\`[3/8]\`, \`(3/8)\`, \`3 of 8\`), a test summary (\`49 passed, 1 failed, 50 total\`) or a coverage table. When a command is expected to take more than a few seconds or runs several steps, make its progress measurable:
- In a loop or multi-step script, print a step marker before each step: \`echo "[$i/$total] <step>"\`.
- Prefer tool flags that print progress or a summary as plain text: \`curl -# -o <file>\`, \`wget --progress=dot:giga\`, \`rsync --info=progress2\`, \`docker build --progress=plain\`, test runners with their summary reporter (\`pytest -q\`, \`jest\`, \`vitest run\`, \`cargo test\`), coverage with a text report.
- Do not pipe a long command into \`tail\`, \`head\` or \`grep\` when that hides its progress lines; filter its saved output afterwards instead.
- Do not add markers to quick commands (\`ls\`, \`git status\`, \`cat\`): only where the wait is real.`

const TASK_NOTICE = /<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g

/**
 * Claude Code streams a Bash call's output to
 * `<tmp>/claude-<uid>/<project>/<session id>/tasks/<task id>.output` while it
 * runs, foreground or background, so the command is read, never rewritten
 * (permission rules keep matching it).
 */
let tasksDir: string | null = null
const claimed = new Set<string>()
// Commands start one at a time until each has shown its output file, so two
// parallel calls never take each other's file.
let startQueue: Promise<void> = Promise.resolve()

function acquireStart(): Promise<() => void> {
  let release = () => {}
  const turn = new Promise<void>(resolve => {
    release = resolve
  })
  const ready = startQueue.then(() => release)
  startQueue = startQueue.then(() => turn)

  return ready
}

async function findTasksDir($: EngineInterface): Promise<string | null> {
  if (tasksDir !== null) {
    return tasksDir
  }
  try {
    return await searchTasksDir($)
  } catch {
    return null
  }
}

async function searchTasksDir($: EngineInterface): Promise<string | null> {
  const sid = await $.session.id()
  const roots = new Set(['/private/tmp', '/tmp'])
  for (const value of [await $.env.get('CLAUDE_CODE_TMPDIR'), await $.env.get('TMPDIR')]) {
    if (value) {
      roots.add(value.replace(/\/+$/, ''))
    }
  }
  for (const root of roots) {
    const bases = await $.fs.list(root).catch(() => [])
    for (const base of bases.filter(entry => entry.name.startsWith('claude-'))) {
      const projects = await $.fs.list(`${root}/${base.name}`).catch(() => [])
      for (const project of projects) {
        const dir = `${root}/${base.name}/${project.name}/${sid}/tasks`
        if (await $.fs.exists(dir).catch(() => false)) {
          tasksDir = dir

          return dir
        }
      }
    }
  }

  return null
}

async function outputFiles($: EngineInterface): Promise<Set<string>> {
  const dir = await findTasksDir($)
  const entries = dir ? await $.fs.list(dir).catch(() => []) : []

  return new Set(
    entries.filter(entry => entry.name.endsWith('.output')).map(entry => `${dir}/${entry.name}`),
  )
}

async function readOutput($: EngineInterface, path: string): Promise<string | null> {
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null || stat.size > MAX_READ) {
    return null
  }

  return $.fs.read(path).catch(() => null)
}

function labelOf(command: string, description: string | undefined): string {
  return (description ?? command).replace(/\s+/g, ' ').trim()
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

type Settings = {
  keepDone: number
  barWidth: number
  autoDismissMs: number
  notifyAfterMs: number
  stallMs: number
  hasGuidance: boolean
}

function settingsOf(options: Readonly<Record<string, unknown>>): Settings {
  return {
    keepDone: Math.max(1, numberOption(options.keepDone, 3)),
    barWidth: Math.min(40, Math.max(5, numberOption(options.barWidth, 20))),
    autoDismissMs: numberOption(options.autoDismissMinutes, 0) * 60_000,
    notifyAfterMs: numberOption(options.notifyAfterSeconds, 60) * 1000,
    stallMs: numberOption(options.stallSeconds, 30) * 1000,
    hasGuidance: options.guidance !== false,
  }
}

function patch($: EngineInterface, id: string, fields: Partial<Run>) {
  return update($, runs, list => list.map(one => (one.id === id ? { ...one, ...fields } : one)))
}

/** Reads a running row's file once and records what it reports. */
async function poll($: EngineInterface, run: Run) {
  const text = run.file === null ? null : await readOutput($, run.file)
  const found = text === null ? null : parseProgress(text)
  const now = await $.clock.now()
  const hasChanged = found !== null && (found.percent !== run.percent || found.detail !== run.detail)
  const isFirst = found !== null && run.firstAt === null

  await patch($, run.id, {
    updatedAt: now,
    ...(found ? { percent: found.percent, detail: found.detail } : {}),
    ...(hasChanged ? { changedAt: now } : {}),
    ...(isFirst ? { firstPercent: found.percent, firstAt: now } : {}),
  })
}

/** Marks a row finished with its measurable outcome, or drops it when there is none. */
async function finish(
  $: EngineInterface,
  settings: Settings,
  id: string,
  output: string,
  isFailed: boolean,
) {
  const last = (await read($, runs)).find(one => one.id === id)
  if (last === undefined) {
    return
  }
  const outcome = parseOutcome(output)
  const percent = outcome?.percent ?? last.percent
  if (percent === null) {
    await update($, runs, list => list.filter(one => one.id !== id))

    return
  }
  const endedAt = await $.clock.now()
  const done: Run = {
    ...last,
    percent,
    detail: outcome?.detail ?? last.detail,
    updatedAt: endedAt,
    isDone: true,
    isFailed,
  }
  await update($, runs, list => {
    const marked = list.map(one => (one.id === id ? done : one))
    const finished = marked.filter(one => one.isDone)

    return marked.filter(
      one => !one.isDone || finished.indexOf(one) >= finished.length - settings.keepDone,
    )
  })
  if (settings.notifyAfterMs > 0 && endedAt - done.startedAt >= settings.notifyAfterMs) {
    void $.ui.notify(summaryOf(done), { title: 'shell-progress' }).catch(() => undefined)
  }
}

/** Hands a row over to the session's poller: it now runs as background task `taskId`. */
async function toBackground($: EngineInterface, id: string, taskId: string, file: string | null) {
  const dir = await findTasksDir($)
  const path = file ?? (dir === null ? null : `${dir}/${taskId}.output`)
  await patch($, id, { taskId, file: path })
}

/** One pass of the session's poller: background rows, then the auto-dismiss. */
async function pollBackground($: EngineInterface, settings: Settings) {
  const list = await read($, runs)
  for (const run of list.filter(one => !one.isDone && one.taskId !== null)) {
    await poll($, run)
  }
  if (settings.autoDismissMs > 0) {
    const now = await $.clock.now()
    const isStale = (run: Run) =>
      run.isDone && !run.isFailed && now - run.updatedAt >= settings.autoDismissMs
    if (list.some(isStale)) {
      await update($, runs, all => all.filter(run => !isStale(run)))
    }
  }
}

/** One pass of a foreground call's own poller. */
async function pollForeground($: EngineInterface, id: string) {
  const current = (await read($, runs)).find(one => one.id === id)
  if (current && current.taskId === null) {
    await poll($, current)
  }
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  const { barWidth, stallMs, hasGuidance } = settings

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: COMMAND, description: 'Убрать завершённые строки прогресса' })
      .catch(() => undefined)

    let isBusy = false
    $.clock.every(POLL_MS, () => {
      if (isBusy) {
        return
      }
      isBusy = true
      void pollBackground($, settings)
        .catch(() => undefined)
        .finally(() => {
          isBusy = false
        })
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const finished = (await read($, runs)).filter(run => run.isDone)
    await update($, runs, all => all.filter(run => !run.isDone))

    return {
      text:
        finished.length === 0
          ? 'Нет завершённых задач для очистки.'
          : `Убрано строк: ${finished.length}.`,
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!hasGuidance || !e.tools.includes('Bash') || e.traits.includes('bare')) {
      return composed
    }

    return {
      sections: [
        ...composed.sections,
        { id: `${COMMAND}:guidance`, text: GUIDANCE, scope: 'session' as const },
      ],
    }
  })

  // A background task's end reaches the conversation as a <task-notification>.
  on('session.append', async ($, e, next) => {
    const appended = await next(e)
    const text = JSON.stringify(e.message)
    if (!text.includes('task-id')) {
      return appended
    }
    const list = await read($, runs)
    for (const [, taskId, status] of text.matchAll(TASK_NOTICE)) {
      const run = list.find(one => !one.isDone && one.taskId === taskId)
      if (run === undefined) {
        continue
      }
      const output = run.file === null ? '' : ((await readOutput($, run.file)) ?? '')
      await finish($, settings, run.id, output, status !== 'completed')
      if (run.file !== null) {
        claimed.delete(run.file)
      }
    }

    return appended
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const id = e.tool_use_id
    const startedAt = await $.clock.now()
    const run: Run = {
      id,
      label: labelOf(e.command, e.description),
      startedAt,
      updatedAt: startedAt,
      changedAt: startedAt,
      percent: null,
      detail: null,
      firstPercent: null,
      firstAt: null,
      file: null,
      taskId: null,
      isDone: false,
      isFailed: false,
    }
    await update($, runs, list => [...list, run])

    // Start the command, then wait for its output file before the next one starts.
    const release = await acquireStart()
    let file: string | null = null
    let isSettled = false
    const before = await outputFiles($)
    const ran = next(e)
    void ran.finally(() => {
      isSettled = true
    })
    try {
      for (
        let waited = 0;
        file === null && !isSettled && waited < CLAIM_WAIT_MS;
        waited += CLAIM_STEP_MS
      ) {
        const fresh = [...(await outputFiles($))].filter(
          path => !before.has(path) && !claimed.has(path),
        )
        file = fresh[0] ?? null
        if (file === null && !isSettled) {
          await $.clock.sleep(CLAIM_STEP_MS, { signal: next.signal }).catch(() => undefined)
        }
      }
      if (file !== null) {
        claimed.add(file)
        await patch($, id, { file })
      }
    } finally {
      release()
    }

    let isBusy = false
    const timer = $.clock.every(POLL_MS, () => {
      if (isBusy) {
        return
      }
      isBusy = true
      void pollForeground($, id)
        .catch(() => undefined)
        .finally(() => {
          isBusy = false
        })
    })

    let isHandedOver = false
    try {
      const answer = await ran
      timer.cancel()
      if (answer.deny !== undefined) {
        await update($, runs, list => list.filter(one => one.id !== id))

        return answer
      }
      const result = answer.isError !== true ? answer.result : undefined
      if (result?.backgroundTaskId !== undefined) {
        // run_in_background, ctrl+b or a timeout: the session's poller takes it on.
        await toBackground($, id, result.backgroundTaskId, file)
        isHandedOver = true

        return answer
      }
      const output =
        result !== undefined
          ? `${result.stdout}\n${result.stderr}`
          : typeof answer.text === 'string'
            ? answer.text
            : ''
      await finish($, settings, id, output, answer.isError === true || result?.interrupted === true)

      return answer
    } finally {
      timer.cancel()
      if (file !== null && !isHandedOver) {
        claimed.delete(file)
      }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = (await read($, runs)).filter(run => run.percent !== null)
    if (e.props.hasSurvey || shown.length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const dismiss = (id: string | null) =>
      update($, runs, list => list.filter(run => !run.isDone || (id !== null && run.id !== id)))
    const doneCount = shown.filter(run => run.isDone).length
    const rows = shown.slice(-Math.max(1, e.props.maxRows - (doneCount > 1 ? 1 : 0)))

    // Fixed-width columns first, the free-length description last, so bars line up.
    const width = e.props.bodyColumns < 90 ? Math.min(10, barWidth) : barWidth
    const detailWidth = Math.max(0, ...rows.map(run => (run.detail ?? '').length))
    const fixed = 2 + width + 13 + ETA_WIDTH + 1 + (detailWidth > 0 ? detailWidth + 1 : 0) + 2 + 4
    const labelWidth = Math.max(10, e.props.bodyColumns - fixed)

    return (
      <Box flexDirection="column">
        {rows.map(run => {
          const isStalled = columnsOf(run, stallMs, 0).includes('стоит')
          const color = run.isFailed ? 'red' : run.isDone ? 'green' : isStalled ? 'yellow' : 'cyan'
          const mark = run.isDone ? (run.isFailed ? '✗' : '✓') : run.taskId !== null ? '◦' : '•'

          return (
            <Box key={run.id}>
              <Text color={color} dimColor={isStalled}>
                {mark} {bar(run.percent ?? 0, width)}
              </Text>
              <Text dimColor={isStalled}>{columnsOf(run, stallMs, detailWidth)}  </Text>
              <Text dimColor>{truncate(run.label, labelWidth)} </Text>
              {run.isDone && (
                <Button key={`dismiss-${run.id}`} label="✕" onPress={() => dismiss(run.id)} />
              )}
            </Box>
          )
        })}
        {doneCount > 1 && (
          <Box key="dismiss-all">
            <Button key="dismiss-all" label="Убрать завершённые" onPress={() => dismiss(null)} />
          </Box>
        )}
      </Box>
    )
  })
}
