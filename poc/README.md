# Proofs of concept

Small scripts used to settle the risky decisions before building on them. Results are in `docs/decisions/`.

- `conpty-osc.mjs` and `wsl-osc.sh`: do OSC sequences stay in order through ConPTY? (ADR-001)
- `conpty-throughput.mjs`: raw ConPTY speed for cmd, PowerShell and WSL (ADR-007)
- `native-smoke/`: node-pty and better-sqlite3 inside the real Electron runtime (ADR-006)

Run with the Windows Node: `node poc\conpty-osc.mjs`. These scripts do not clean up a child that ignores `kill()`; check Task Manager afterwards.
