/** Asks the active session to take keyboard focus (its terminal, or its command editor at a prompt). */
export const FOCUS_SESSION_EVENT = 'agentdock:focus-session';

export function focusActiveSession(): void {
  // after the closing menu or dialog has finished returning focus to its own trigger
  setTimeout(() => window.dispatchEvent(new Event(FOCUS_SESSION_EVENT)), 0);
}
