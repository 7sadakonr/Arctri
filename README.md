# AgentDock

A Windows-first terminal built around AI coding agents. It is a real terminal (PTY + ConPTY), not a console
simulation, with Warp-style command blocks, autocomplete, WSL2 support and first-class Thai input. It is not an IDE.

Status: MVP 1, v0.1.0. Windows 10 22H2 and Windows 11 (x64). WSL2 is optional.

## Features

- **Shells:** Windows PowerShell 5.1, PowerShell 7, Command Prompt, and bash/zsh in every WSL distribution.
- **Command blocks:** each command becomes a block with output, status, exit code, duration, folder, shell and time.
  Copy command / output, run again, collapse, keyboard navigation. Full-screen programs (vim, htop, less, ssh, agent TUIs)
  take over the terminal. If command boundaries cannot be detected reliably the tab simply works as a normal terminal.
- **Autocomplete:** history, commands, paths, git, npm/pnpm scripts. Tab accepts, Esc dismisses, nothing runs by itself.
- **Agents:** Codex CLI and Claude Code, native interactive UI, separately detected on Windows and in each WSL distro.
  The toolbar shows only what the installed CLI really supports. Authentication stays with the CLI.
- **Thai:** UTF-8 everywhere, Thai IME in the editor, Thai UI (English/Thai switchable).
- **Local first:** no account, no cloud, no telemetry. History and preferences stay on this PC.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+Shift+T / Ctrl+Shift+W | New tab (same shell and folder) / close tab |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9 | Switch tabs |
| F2 | Rename tab |
| Ctrl+Up / Ctrl+Down | Select previous / next block |
| Enter / Shift+Enter | Run / new line in the editor |
| Tab, Esc, Up/Down | Accept, dismiss, move through suggestions or history |
| Ctrl+C (selection) / Ctrl+V | Copy / paste; Ctrl+C without selection interrupts |
| Ctrl+, | Settings |

## Develop

Use the **Windows** Node.js (22+). Do not run `npm install` from WSL in this folder: it would fetch Linux binaries.
From WSL, run commands through Windows: `cmd.exe /c "cd /d D:\path\to\Arctri && npm test"`.

```
npm install
node node_modules/electron/install.js    # npm 12 blocks install scripts, so fetch the Electron binary once
npm run dev                              # run with hot reload
npm run typecheck && npm run lint && npm test
npm run test:integration                 # real PTYs; needs PowerShell and (optionally) a WSL distro named Ubuntu
npm run build && npm run test:e2e        # Playwright against the built app
npm run dist                             # installer in release/
npm run test:smoke                       # start the unpacked build and wait for a shell prompt
```

Environment variables for tests: `AGENTDOCK_USER_DATA` (isolated profile), `AGENTDOCK_E2E=1` (read-only test hook),
`AGENTDOCK_FAKE_WSL=missing` (simulate no WSL), `AGENTDOCK_SKIP_WSL=1` (skip WSL integration tests).

## Notes for contributors

- Terminal processes run in worker threads (`src/main/pty`), one per session, so a slow `CreateProcess` never freezes the window (ADR-008).
- The bundled `conpty.dll` is the default; the Windows 10 inbox ConPTY loses Thai marks in PowerShell 5.1 and reorders OSC sequences (ADR-001, 003).
- Integration tests use real shells. WSL tests expect a distribution named `Ubuntu`; set `AGENTDOCK_SKIP_WSL=1` to skip them.
- To run the real agent CLIs without sending prompts: `set AGENTDOCK_REAL_AGENTS=1 && npx playwright test tests/e2e/real-agents.spec.ts`.

## Layout

```
src/shared     pure TypeScript: OSC tokenizer, shell state machine, completion tokenizer/ranking, i18n, IPC contract
src/main       Electron main: PTY sessions, WSL, shell integration launch, completion, agents, persistence
src/preload    typed, validated bridge (contextIsolation, sandbox, no Node in the page)
src/renderer   React UI: tabs, block list, editor, toolbar, settings
resources/shell-integration   scripts loaded by PowerShell, bash, zsh and the WSL helper
tests          integration (real PTYs) and e2e (Playwright)
docs           ADRs (docs/decisions), manual test checklist, release notes
```

How blocks work next to a real PTY is explained in `docs/decisions/ADR-002-block-lifecycle.md`; the plan and the
reasoning behind each choice are in `PLAN.md`.
