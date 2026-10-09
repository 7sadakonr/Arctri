/** Milliseconds since process start for named startup milestones (reported by the smoke test). */
export const timing: Record<string, number> = {};
export const mark = (k: string): void => {
  if (timing[k] === undefined) timing[k] = Math.round(process.uptime() * 1000);
};
