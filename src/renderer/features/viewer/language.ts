import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';

/** The syntax highlighting for a file name; loaded on first use so the editor packs stay out of the startup bundle. */
export async function languageFor(name: string): Promise<Extension | undefined> {
  const ext = /\.([^.\\/]+)$/.exec(name.toLowerCase())?.[1] ?? '';
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'ts': case 'tsx': case 'mts': case 'cts':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
    case 'json': case 'jsonc':
      return (await import('@codemirror/lang-json')).json();
    case 'css': case 'scss':
      return (await import('@codemirror/lang-css')).css();
    case 'html': case 'htm': case 'svg': case 'xml':
      return (await import('@codemirror/lang-html')).html();
    case 'md': case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown();
    case 'py':
      return (await import('@codemirror/lang-python')).python();
    case 'rs':
      return (await import('@codemirror/lang-rust')).rust();
    case 'go':
      return (await import('@codemirror/lang-go')).go();
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql();
    case 'yml': case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'sh': case 'bash': case 'zsh':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
    case 'toml':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml);
    default:
      return undefined;
  }
}
