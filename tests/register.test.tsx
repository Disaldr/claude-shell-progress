import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'shell-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const CLEAR = {
  command: 'shell-progress',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const DIR = '/private/tmp/claude-501/proj/sid/tasks'

type Fake = {
  clock: MockClock
  notified: string[]
  /** Appends a line to the command's output file. */
  print: (id: string, text: string) => void
  /** Ends a foreground command, its output as its stdout. */
  end: (id: string) => void
}

/**
 * Beneath the plugin: a clock, a session tasks folder in memory, a Bash whose
 * output the test writes line by line (`<id>.output`; a background call's
 * `task-<id>.output`, answered at once), and a notifier that records texts.
 */
function engineBeneath(on: On, background: string[] = [], locale?: string): Fake {
  const clock = mock.clock(on, { now: 1_000 })
  const files = new Map<string, string>()
  const endings = new Map<string, () => void>()
  const notified: string[] = []
  const fileOf = (id: string) => `${background.includes(id) ? `task-${id}` : id}.output`
  const nameOf = (path: string) => path.slice(DIR.length + 1)
  const entry = (name: string, kind: 'file' | 'dir', size = 0) => ({
    name,
    kind,
    size,
    mtimeMs: 0,
    isLink: false,
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine-band" />
  })
  on('session.start', ($, e) => e as never)
  on('session.id', () => ({ value: 'sid' }))
  on('env.get', ($, e) => ({ value: e.name === 'LANG' ? locale : undefined }))
  on('fs.exists', ($, e) => ({ value: e.path === DIR }))
  on('fs.list', ($, e) => {
    if (e.path === '/private/tmp') {
      return { value: [entry('claude-501', 'dir')] }
    }
    if (e.path === '/private/tmp/claude-501') {
      return { value: [entry('proj', 'dir')] }
    }
    if (e.path === DIR) {
      return { value: [...files].map(([name, text]) => entry(name, 'file', text.length)) }
    }

    return { value: [] }
  })
  on('fs.stat', ($, e) => {
    const text = files.get(nameOf(e.path))

    return text === undefined
      ? { deny: 'ENOENT' }
      : { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const text = files.get(nameOf(e.path))

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('ui.notify', ($, e) => {
    notified.push(e.text)

    return { value: { isSent: true, channel: 'terminal_bell' } } as never
  })
  on('tool.call', ($, e) => {
    const id = e.tool_use_id ?? 'none'
    const name = fileOf(id)
    files.set(name, '')
    if (background.includes(id)) {
      return {
        result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `task-${id}` },
      } as never
    }

    return new Promise(resolve => {
      endings.set(id, () => {
        const stdout = files.get(name) ?? ''
        files.delete(name)
        resolve({ result: { stdout, stderr: '', interrupted: false } } as never)
      })
    })
  })

  return {
    clock,
    notified,
    print: (id, text) => {
      const name = fileOf(id)
      files.set(name, `${files.get(name) ?? ''}${text}\n`)
    },
    end: id => endings.get(id)?.(),
  }
}

function call($: Engine, id: string, description: string) {
  return $.tool.call({ tool: 'Bash', tool_use_id: id, command: 'run', description })
}

async function texts(ui: { findAll: (q: { type: 'Text' }) => Promise<{ text?: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
}

/** Prints `[i/total]` every `ms`, from step `from` to `to`, moving the clock. */
async function steps(fake: Fake, id: string, from: number, to: number, total: number, ms: number) {
  for (let i = from; i <= to; i++) {
    fake.print(id, `[${i}/${total}] step`)
    await fake.clock.advance(ms)
  }
}

/** Runs a quick finished command with a 2/2 result. */
async function quick($: Engine, fake: Fake, id: string) {
  const running = call($, id, `job ${id}`)
  await fake.clock.advance(100)
  await steps(fake, id, 1, 2, 2, 600)
  fake.end(id)
  await running
}

test('the system prompt gains the progress guidance when Bash is offered', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  const ask = {
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    traits: [],
    surfaces: [],
    outputStyle: null,
  } as const

  const withBash = await $.prompt.compose({ ...ask, tools: ['Bash'] })
  expect(withBash.sections.map(s => s.id)).toEqual(['intro', 'shell-progress:guidance'])
  expect(withBash.sections[1]?.text).toContain('[$i/$total]')

  const without = await $.prompt.compose({ ...ask, tools: ['Read'] })
  expect(without.sections.map(s => s.id)).toEqual(['intro'])
})

test('the guidance can be switched off', { options: { guidance: false } }, async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    traits: [],
    surfaces: [],
    outputStyle: null,
    tools: ['Bash'],
  })
  expect(composed.sections.map(s => s.id)).toEqual(['intro'])
})

test('a running command shows live percent, steps and remaining time', async ($, on) => {
  const fake = engineBeneath(on)
  const running = call($, 'a', 'Build modules')
  await fake.clock.advance(100)
  await steps(fake, 'a', 1, 4, 10, 1000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const live = (await texts(ui)).join('|')
  expect(live).toMatch(/• █+░+\|/)
  expect(live).toMatch(/ {3}[34]0% {2}0:0[34] ~0:0\d/)
  expect(live).toMatch(/[34]\/10/)
  expect(live).toContain('Build modules')

  await steps(fake, 'a', 5, 10, 10, 1000)
  fake.end('a')
  await running
  const done = (await texts(ui)).join('|')
  expect(done).toMatch(/✓ █{20}\|/)
  expect(done).toMatch(/100% {2}0:1\d {14}10\/10/)
  expect(await ui.find({ key: 'dismiss-a' })).toBeDefined()
  await ui.unmount()
})

test('progress that stands still is marked', async ($, on) => {
  const fake = engineBeneath(on)
  const running = call($, 'a', 'Slow job')
  await fake.clock.advance(100)
  fake.print('a', '[1/5] step')
  await fake.clock.advance(36_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await texts(ui)).join('|')).toMatch(/stalled 0:3\d/)

  fake.end('a')
  await running
  await ui.unmount()
})

test('two commands started together keep their own output', async ($, on) => {
  const fake = engineBeneath(on)
  const first = call($, 'a', 'First job')
  const second = call($, 'b', 'Second job')
  await fake.clock.advance(200)
  fake.print('a', '[1/4] a')
  fake.print('b', 'download 50%')
  await fake.clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = (await texts(ui)).join('|')
  expect(rows).toMatch(/ {3}25%[^|]*1\/4[^|]*\|First job/)
  expect(rows).toMatch(/ {3}50%[^|]*\|Second job/)

  fake.end('a')
  fake.end('b')
  await Promise.all([first, second])
  await ui.unmount()
})

test('a background command is followed until its task notification', async ($, on) => {
  const fake = engineBeneath(on, ['a'])
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await call($, 'a', 'Background build')
  await steps(fake, 'a', 1, 2, 4, 1000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await texts(ui)).join('|')).toMatch(/◦ █+░+\|[^|]*50%[^|]*2\/4/)

  await steps(fake, 'a', 3, 4, 4, 1000)
  await $.session.append({
    message: {
      type: 'user',
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<task-notification><task-id>task-a</task-id><status>completed</status></task-notification>',
        },
      ],
    },
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: 'u1',
  } as never)
  expect((await texts(ui)).join('|')).toMatch(/✓ █{20}\|[^|]*100%[^|]*4\/4/)
  await ui.unmount()
})

test('a long command notifies when it ends; a short one does not', async ($, on) => {
  const fake = engineBeneath(on)
  const long = call($, 'long', 'Long build')
  await fake.clock.advance(100)
  await steps(fake, 'long', 1, 2, 2, 40_000)
  fake.end('long')
  await long
  await quick($, fake, 'short')

  expect(fake.notified).toHaveLength(1)
  expect(fake.notified[0]).toMatch(/^✓ Long build · 100% · 2\/2 · 1:2\d$/)
})

test('✕ removes one finished row, «Clear finished» the rest', async ($, on) => {
  const fake = engineBeneath(on)
  for (const id of ['a', 'b', 'c']) {
    await quick($, fake, id)
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'dismiss-a' })
  expect(await ui.find({ key: 'dismiss-a' })).toBeUndefined()
  expect(await ui.find({ key: 'dismiss-b' })).toBeDefined()

  await ui.press({ key: 'dismiss-all' })
  expect(await ui.find({ key: 'dismiss-b' })).toBeUndefined()
  expect(await ui.find({ key: 'dismiss-c' })).toBeUndefined()
  await ui.unmount()
})

test('keepDone limits the finished rows kept', { options: { keepDone: 1 } }, async ($, on) => {
  const fake = engineBeneath(on)
  for (const id of ['a', 'b']) {
    await quick($, fake, id)
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'dismiss-a' })).toBeUndefined()
  expect(await ui.find({ key: 'dismiss-b' })).toBeDefined()
  await ui.unmount()
})

test(
  'successful rows go away by themselves after autoDismissMinutes',
  { options: { autoDismissMinutes: 1 } },
  async ($, on) => {
    const fake = engineBeneath(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await quick($, fake, 'a')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'dismiss-a' })).toBeDefined()

    await fake.clock.advance(61_000)
    expect(await ui.find({ key: 'dismiss-a' })).toBeUndefined()
    await ui.unmount()
  },
)

test('/shell-progress clears finished rows and says how many', async ($, on) => {
  const fake = engineBeneath(on)
  for (const id of ['a', 'b']) {
    await quick($, fake, id)
  }

  const ran = await $.command.run(CLEAR)
  expect(JSON.stringify(ran)).toContain('Cleared 2 rows.')

  const again = await $.command.run(CLEAR)
  expect(JSON.stringify(again)).toContain('No finished rows to clear.')
})

test('language option: Russian words in the band and the command', {
  options: { language: 'ru' },
}, async ($, on) => {
  const fake = engineBeneath(on)
  const running = call($, 'a', 'Тесты')
  await fake.clock.advance(100)
  fake.print('a', 'Tests:       1 failed, 49 passed, 50 total')
  fake.end('a')
  await running
  await quick($, fake, 'b')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const band = (await texts(ui)).join('|')
  expect(band).toContain('тесты 49/50, упало 1')
  expect(JSON.stringify(await ui.find({ key: 'dismiss-all' }))).toContain('Убрать завершённые')
  await ui.unmount()

  expect(JSON.stringify(await $.command.run(CLEAR))).toContain('Убрано строк: 2')
})

test('auto follows the locale: LANG=de_DE.UTF-8 gives German', async ($, on) => {
  const fake = engineBeneath(on, [], 'de_DE.UTF-8')
  const running = call($, 'a', 'Langsam')
  await fake.clock.advance(100)
  fake.print('a', '[1/5] step')
  await fake.clock.advance(36_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await texts(ui)).join('|')).toMatch(/steht 0:3\d/)
  fake.end('a')
  await running
  await ui.unmount()
})

test('an unsupported locale falls back to English', async ($, on) => {
  const fake = engineBeneath(on, [], 'ja_JP.UTF-8')
  await quick($, fake, 'a')
  expect(JSON.stringify(await $.command.run(CLEAR))).toContain('Cleared 1 row.')
})
