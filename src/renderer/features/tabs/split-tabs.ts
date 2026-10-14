const TAB_MIN = 110;
const PINNED_W = 40;
const RESERVED = 64; // the "+" buttons and the overflow button

/** Which tabs fit: pinned ones always, the rest as many as the width allows, and the active one is never hidden. */
export function splitTabs(order: string[], pinned: Record<string, boolean>, active: string | undefined, width: number): { shown: string[]; hidden: string[] } {
  const pins = order.filter((id) => pinned[id]);
  const rest = order.filter((id) => !pinned[id]);
  if (width <= 0) return { shown: order, hidden: [] };
  const cap = Math.max(1, Math.floor((width - pins.length * PINNED_W - RESERVED) / TAB_MIN));
  if (rest.length <= cap) return { shown: order, hidden: [] };
  let visible = rest.slice(0, cap);
  if (active && rest.includes(active) && !visible.includes(active)) visible = [...visible.slice(0, cap - 1), active];
  const hidden = rest.filter((id) => !visible.includes(id));
  return { shown: [...pins, ...rest.filter((id) => visible.includes(id))], hidden };
}
