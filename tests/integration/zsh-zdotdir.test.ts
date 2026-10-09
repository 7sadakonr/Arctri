import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WslManager } from '../../src/main/wsl/wsl-manager';

const wsl = new WslManager();
const sh = (c: string) => wsl.exec('Ubuntu', ['sh', '-c', c], 30000);

describe.skipIf(!!process.env['ARCTRI_SKIP_WSL'])('zsh shim with a ZDOTDIR the user set themselves', () => {
  it('uses the user\'s own startup files and still loads the integration', async () => {
    const shim = await wsl.toPosix('Ubuntu', join(process.cwd(), 'resources', 'shell-integration', 'zsh'));
    const home = `/tmp/adz-${Date.now()}`;
    await sh(`mkdir -p '${home}/.config/zsh' && printf 'export ZDOTDIR="$HOME/.config/zsh"\\n' > '${home}/.zshenv' && printf 'echo USER_ZSHRC_RAN\\n' > '${home}/.config/zsh/.zshrc'`);
    const r = await sh(
      `printf 'exit\\n' | HOME='${home}' ARCTRI_NONCE=zz ARCTRI_BLOCKS=1 USER_ZDOTDIR='${home}' ZDOTDIR='${shim}' SHELL=/bin/sh script -qec 'zsh -i' /dev/null`
    );
    await sh(`rm -rf '${home}'`);
    expect(r.stdout).toContain('USER_ZSHRC_RAN'); // the user's moved ZDOTDIR was respected
    expect(r.stdout).toContain(']6973;zz;hello;zsh'); // and the integration loaded from the shim directory
  });

  it('with no custom ZDOTDIR the user\'s home files run and nothing is written into the app folder', async () => {
    const shim = await wsl.toPosix('Ubuntu', join(process.cwd(), 'resources', 'shell-integration', 'zsh'));
    const home = `/tmp/adz2-${Date.now()}`;
    await sh(`mkdir -p '${home}' && printf 'echo HOME_ZSHRC_RAN\\nautoload -Uz compinit && compinit\\n' > '${home}/.zshrc'`);
    const before = (await sh(`ls -A '${shim}'`)).stdout;
    const r = await sh(
      `printf 'exit\\n' | HOME='${home}' ARCTRI_NONCE=zz ARCTRI_BLOCKS=1 USER_ZDOTDIR='${home}' ZDOTDIR='${shim}' SHELL=/bin/sh script -qec 'zsh -i' /dev/null`
    );
    const after = (await sh(`ls -A '${shim}'`)).stdout;
    const dumpInHome = (await sh(`ls -A '${home}'`)).stdout;
    await sh(`rm -rf '${home}'`);
    expect(r.stdout).toContain('HOME_ZSHRC_RAN');
    expect(r.stdout).toContain(']6973;zz;hello;zsh');
    expect(after).toBe(before); // nothing was written into the application folder
    expect(dumpInHome).toContain('.zcompdump'); // zsh's own files went to the user's folder
  });
});
