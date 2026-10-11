// Runs the integration tests with ARCTRI_INTEGRATION=1 set, the same way on Windows, macOS and Linux
// (`set X=1&& cmd` only works in cmd.exe).
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ARCTRI_INTEGRATION: '1' }
});
process.exit(r.status ?? 1);
