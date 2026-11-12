import { memo } from 'react';
import type { BlockSnapshot, CellStyle, StyledLine } from '@shared/types/block';
import { resolveColor } from '../terminal/theme';

function styleCss(s: CellStyle, dark: boolean): React.CSSProperties {
  let fg = resolveColor(s.fg, dark);
  let bg = resolveColor(s.bg, dark);
  if (s.inverse) [fg, bg] = [bg ?? (dark ? '#0a0a0a' : '#ededed'), fg ?? (dark ? '#ededed' : '#111111')];
  const css: React.CSSProperties = {};
  if (fg) css.color = fg;
  if (bg) css.backgroundColor = bg;
  if (s.bold) css.fontWeight = 600;
  if (s.dim) css.opacity = 0.6;
  if (s.italic) css.fontStyle = 'italic';
  if (s.underline || s.strike) css.textDecoration = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (s.invisible) css.visibility = 'hidden';
  return css;
}

const CHUNK = 100;

/** Powerline separators drawn as shapes: a glyph from a symbol face rarely matches the row height, so its point misses the neighbouring block. */
const POWERLINE: Record<string, string> = {
  '\ue0b0': 'polygon(0 0, 100% 50%, 0 100%)',
  '\ue0b2': 'polygon(100% 0, 0 50%, 100% 100%)',
  '\ue0b8': 'polygon(0 0, 0 100%, 100% 100%)',
  '\ue0ba': 'polygon(100% 0, 100% 100%, 0 100%)',
  '\ue0bc': 'polygon(0 0, 100% 0, 0 100%)',
  '\ue0be': 'polygon(0 0, 100% 0, 100% 100%)',
  '\ue0b4': 'ellipse(100% 50% at 0 50%)',
  '\ue0b6': 'ellipse(100% 50% at 100% 50%)'
};
/** Separators whose straight edge is on the right. That edge reaches 1px into its neighbour so no hairline of background shows between the two. */
const RIGHT_FLAT = new Set(['\ue0b2', '\ue0ba', '\ue0be', '\ue0b6']);
const POWERLINE_SPLIT = /([\ue0b0\ue0b2\ue0b4\ue0b6\ue0b8\ue0ba\ue0bc\ue0be])/;

/** One whole row tall (not just the font's own ascent+descent), so a coloured block and its separator meet exactly. */
const CELL_BOX: React.CSSProperties = { display: 'inline-block', height: '1lh', verticalAlign: 'top' };

function gridRun(text: string, c: React.CSSProperties | undefined, key: number): React.ReactNode {
  const parts = text.split(POWERLINE_SPLIT);
  return parts.map((part, j) => {
    if (!part) return null;
    const shape = POWERLINE[part];
    if (shape) {
      return (
        <span key={`${key}.${j}`} style={{ ...CELL_BOX, position: 'relative', width: '1ch', backgroundColor: c?.backgroundColor }}>
          <span style={{ position: 'absolute', top: 0, bottom: 0, ...(RIGHT_FLAT.has(part) ? { left: 0, right: -1 } : { left: -1, right: 0 }), background: c?.color ?? 'currentColor', clipPath: shape }} />
        </span>
      );
    }
    return c?.backgroundColor ? (
      <span key={`${key}.${j}`} style={{ ...CELL_BOX, ...c }}>
        {part}
      </span>
    ) : (
      <span key={`${key}.${j}`} style={c}>
        {part}
      </span>
    );
  });
}

const Line = memo(function Line({ line, css, grid }: { line: StyledLine; css: React.CSSProperties[]; grid: boolean }) {
  if (line.runs.length === 0) return <div>{'​'}</div>;
  return (
    <div>
      {line.runs.map((r, i) => {
        const c = css[r.style];
        if (grid) return gridRun(r.text, c, i);
        return c && Object.keys(c).length > 0 ? (
          <span key={i} style={c}>
            {r.text}
          </span>
        ) : (
          r.text
        );
      })}
    </div>
  );
});

/** Output of a finished command. Lines are grouped so off-screen groups are skipped by the browser. */
/** `grid` draws the rows exactly as the terminal laid them out (same face, one cell per column, never wrapped): used for the live prompt. */
export const SnapshotView = memo(function SnapshotView({ snapshot, dark, grid = false }: { snapshot: BlockSnapshot; dark: boolean; grid?: boolean }) {
  const css = snapshot.styles.map((s) => styleCss(s, dark));
  const groups: StyledLine[][] = [];
  for (let i = 0; i < snapshot.lines.length; i += CHUNK) groups.push(snapshot.lines.slice(i, i + CHUNK));
  return (
    <div className={grid ? 'block-output block-grid' : 'block-output'}>
      {groups.map((g, gi) => (
        <div key={gi} className={groups.length > 1 ? 'block-chunk' : undefined}>
          {g.map((line, li) => (
            <Line key={li} line={line} css={css} grid={grid} />
          ))}
        </div>
      ))}
    </div>
  );
});
