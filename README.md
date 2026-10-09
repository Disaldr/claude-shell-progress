<div align="center">

# ⏳ Shell Progress

**Live progress bars for Claude Code shell commands**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

[![English](https://img.shields.io/badge/lang-English-2ea44f?style=for-the-badge)](README.md)
[![Русский](https://img.shields.io/badge/lang-Русский-lightgrey?style=for-the-badge)](README.ru.md)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/disaldr)

</div>

---

A **Claude Code** plugin: while Claude runs a shell command (the Bash tool) that has a
**measurable result**, a progress bar shows the percent done, elapsed time and time left
— for foreground and background commands alike.

```text
• ████████░░░░░░░░░░░░    40%  0:04 ~0:06      4/10                   Build modules
◦ ██████████░░░░░░░░░░    50%  0:02 ~0:02      2/4                    Background build
• ██████░░░░░░░░░░░░░░    30%  0:41 стоит 0:35 3/10                   Slow job
✓ ███████████████████░    95%  0:14            тесты 38/40, упало 2   Run tests ✕
```

The command itself is never rewritten, so your Bash permission rules keep matching it.

---

## Installation

In a Claude Code terminal session:

```
/plugin install shell-progress --marketplace Disaldr/claude-shell-progress
```

Answer `y` to `Add marketplace?`, then pick a scope (user scope is the first one).
The plugin is active right away, no restart needed.

### From a local clone

```bash
git clone https://github.com/Disaldr/claude-shell-progress.git
claude plugin marketplace add ./claude-shell-progress
claude plugin install shell-progress@clapro
```

A plugin installed from a folder is read from that folder: after editing it, run
`/reload-plugins`. To try it without installing: `claude --plugin-dir ./claude-shell-progress`.

---

## What it shows

One line per command in a band above the prompt. Fixed-width columns come first and the
command's description last, so several bars line up.

| Mark | Meaning |
|---|---|
| `•` | Running |
| `◦` | Running in the background (`run_in_background`, Ctrl+B, or moved there by a timeout) |
| `✓` / `✗` | Finished successfully / with an error |
| `~0:06` | Time left, from the average rate since the first reading |
| `стоит 0:35` | No progress for longer than the threshold: the row dims and turns yellow |

- Finished rows stay until you remove them: **✕** at the end of a row removes one,
  **«Убрать завершённые»** (shown once two or more are finished) removes them all,
  and so does the `/shell-progress` command.
- A command that ran longer than a minute sends a **system notification** when it ends:
  `✓ Long build · 100% · 2/2 · 1:21`.
- Commands with nothing measurable in their output show nothing.

The plugin's own labels are in Russian (`стоит` — stalled, `тесты 38/40, упало 2` —
tests 38/40, 2 failed).

### What counts as measurable

| Source | Output example |
|---|---|
| Percent, `\r` redraws included | `45%`, `73.5%` |
| Steps | `[3/8]`, `(3/8)`, `2 of 4` |
| Test summary (pass rate) | jest, vitest, pytest, mocha, cargo |
| Coverage | `All files \| 87.5`, `TOTAL ... 87%` |

---

## Claude makes progress measurable by itself

The plugin adds a short section to Claude's system prompt (only when the Bash tool is
offered). It asks Claude to make long commands report progress, so the bar shows up
without you asking:

- print a step marker in loops and multi-step scripts: `echo "[$i/$total] <step>"`;
- prefer flags that print progress as plain text: `curl -# -o`, `wget --progress=dot:giga`,
  `rsync --info=progress2`, `docker build --progress=plain`, test runners' summary reporters;
- never hide a long command's progress behind `| tail`, `| head` or `| grep`;
- leave quick commands (`ls`, `git status`) alone.

You can see the section in `/context`, or turn it off with the `guidance` setting.

---

## Settings

Change them in `/config` (the `shell-progress` rows):

| Field | Default | What it does |
|---|---|---|
| `keepDone` | 3 | How many finished rows to keep |
| `barWidth` | 20 | Bar width, 5–40 characters (at most 10 on a narrow terminal) |
| `autoDismissMinutes` | 0 | Remove successful rows after N minutes; 0 — never |
| `notifyAfterSeconds` | 60 | Notify when a command longer than N seconds ends; 0 — never |
| `stallSeconds` | 30 | Mark a row as stalled after N seconds without change; 0 — never |
| `guidance` | true | Add the instructions for Claude to the system prompt |

---

## How it works

While a command runs, Claude Code writes its output to `tasks/<id>.output` in the
session's temporary folder. A `tool.call` hook on Bash reads that file once a second and
looks for a percent or a step count in the newest lines; when the command ends it parses
the whole output for a test summary or coverage.

- **Parallel commands** start one at a time until each has shown its own output file
  (tens of milliseconds), so their outputs never get mixed up.
- **Background commands** are followed by a session-wide timer on
  `tasks/<backgroundTaskId>.output`; the row finishes when the `<task-notification>`
  for that task arrives in the conversation.

---

## Limitations

- Many tools (npm, curl, pip) draw no progress bar when their output is not a terminal.
  A percent shows up only if the tool prints progress as text; test summaries always work.
- Where the output file lives is a Claude Code internal detail, not a public API, and may
  change in a future version.
- Output larger than ~3.5 MB is no longer re-read; the last percent found stays.
- A `2/5`-like step count can occasionally match unrelated numbers in the output.

---

## Development

```bash
claude plugin validate .
claude plugin test .
```

| File | Purpose |
|---|---|
| `hooks/register.tsx` | The hooks: Bash calls, background tasks, the band, the command, the prompt section |
| `hooks/parse.ts` | Parses output: percent, steps, test summary, coverage |
| `hooks/row.ts` | A row's columns, time left and stall mark |
| `tests/` | Parser tests and scenarios on a fake clock and file system |

---

## Support

If this saved you some time, you can buy me a coffee ☕

<div align="center">

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-buymeacoffee.com%2Fdisaldr-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/disaldr)

</div>

---

## License

Released under the [MIT License](LICENSE).
