import type { SessionInfo } from '@shared/types/session';
import { tabLabel } from '../attention/status-view';
import type { TabRef } from './model';

const baseName = (rel: string) => rel.replace(/\\/g, '/').split('/').at(-1) ?? rel;

/** The name a tab goes by in a tab strip (and in the drop preview). */
export function tabLabelOf(tab: TabRef, info: SessionInfo | undefined): string {
  if (tab.kind === 'file') return `${baseName(tab.path ?? tab.rel)}${tab.rev ? ` @${tab.rev.slice(0, 7)}` : ''}`;
  return info ? tabLabel(info) : '';
}
