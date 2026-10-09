import map from './file-icon-map.json';

interface IconMap {
  file: string;
  folder: string;
  folderOpen: string;
  ext: Record<string, string>;
  names: Record<string, string>;
  dirs: Record<string, string>;
  dirsOpen: Record<string, string>;
}
const m = map as IconMap;
const own = (o: Record<string, string>, k: string): string | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Name of the icon (a file in public/file-icons) for a file or folder, chosen like VS Code does. */
export function iconName(name: string, isDir: boolean, open = false): string {
  const lower = name.toLowerCase();
  if (isDir) return (open ? own(m.dirsOpen, lower) ?? m.folderOpen : own(m.dirs, lower) ?? m.folder);
  const byName = own(m.names, lower);
  if (byName) return byName;
  // longest extension first: "a.test.ts" -> "test.ts" -> "ts"
  for (let i = lower.indexOf('.'); i >= 0; i = lower.indexOf('.', i + 1)) {
    const hit = own(m.ext, lower.slice(i + 1));
    if (hit) return hit;
  }
  return m.file;
}

export const iconUrl = (name: string, isDir: boolean, open = false): string =>
  `./file-icons/${iconName(name, isDir, open)}.svg`;
