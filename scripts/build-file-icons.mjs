// Copies the file-type icons of the Material Icon Theme (MIT) used by the file panel and writes the lookup tables.
// Run after changing the folder list or updating the package: `node scripts/build-file-icons.mjs`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = dirname(require.resolve('material-icon-theme/package.json'));
const theme = require('material-icon-theme/dist/material-icons.json');
const out = join(root, 'src/renderer/public/file-icons');

// the theme knows thousands of folder names; these are the ones worth an icon of their own
const FOLDERS = [
  'src', 'source', 'lib', 'dist', 'build', 'out', 'bin', 'test', 'tests', '__tests__', 'spec', 'e2e', 'docs', 'doc',
  'node_modules', 'public', 'static', 'assets', 'images', 'img', 'icons', 'fonts', 'styles', 'css', 'components',
  'features', 'hooks', 'utils', 'helpers', 'config', 'configs', 'scripts', 'resources', 'shared', 'common', 'types',
  'models', 'views', 'pages', 'routes', 'api', 'server', 'client', 'main', 'renderer', 'preload', 'stores', 'store',
  'services', 'middleware', 'migrations', 'database', 'db', 'data', 'tmp', 'temp', 'logs', 'vendor', 'packages',
  'examples', 'tools', 'plugins', 'i18n', 'locales', 'themes', 'mocks', '.git', '.github', '.vscode', '.idea',
  '.claude', '.husky', '.docker', 'docker', 'coverage', 'target', 'venv', '.venv', '__pycache__'
];

const fileIcons = new Set(['file']);
const map = { file: 'file', folder: theme.folder, folderOpen: theme.folderExpanded, ext: {}, names: {}, dirs: {}, dirsOpen: {} };
const need = (icon) => existsSync(join(pkg, 'icons', `${icon}.svg`));
for (const [k, v] of Object.entries(theme.fileExtensions)) if (need(v)) {
    map.ext[k.toLowerCase()] = v;
    fileIcons.add(v);
  }
for (const [k, v] of Object.entries(theme.fileNames)) if (need(v)) {
    map.names[k.toLowerCase()] = v;
    fileIcons.add(v);
  }
const all = new Set([...fileIcons, map.folder, map.folderOpen]);
for (const name of FOLDERS) {
  const c = theme.folderNames[name];
  const o = theme.folderNamesExpanded[name];
  if (c && o && need(c) && need(o)) {
    map.dirs[name] = c;
    map.dirsOpen[name] = o;
    all.add(c);
    all.add(o);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const icon of all) copyFileSync(join(pkg, 'icons', `${icon}.svg`), join(out, `${icon}.svg`));
copyFileSync(join(pkg, 'LICENSE'), join(out, 'LICENSE.material-icon-theme.txt'));
writeFileSync(join(root, 'src/renderer/lib/file-icon-map.json'), JSON.stringify(map));
console.log(`${readdirSync(out).length - 1} icons, ${Object.keys(map.ext).length} extensions, ${Object.keys(map.names).length} names`);
