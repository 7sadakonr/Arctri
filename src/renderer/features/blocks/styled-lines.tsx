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

const Line = memo(function Line({ line, css }: { line: StyledLine; css: React.CSSProperties[] }) {
  if (line.runs.length === 0) return <div>{'​'}</div>;
  return (
    <div>
      {line.runs.map((r, i) => {
        const c = css[r.style];
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
export const SnapshotView = memo(function SnapshotView({ snapshot, dark }: { snapshot: BlockSnapshot; dark: boolean }) {
  const css = snapshot.styles.map((s) => styleCss(s, dark));
  const groups: StyledLine[][] = [];
  for (let i = 0; i < snapshot.lines.length; i += CHUNK) groups.push(snapshot.lines.slice(i, i + CHUNK));
  return (
    <div className="block-output">
      {groups.map((g, gi) => (
        <div key={gi} className={groups.length > 1 ? 'block-chunk' : undefined}>
          {g.map((line, li) => (
            <Line key={li} line={line} css={css} />
          ))}
        </div>
      ))}
    </div>
  );
});
