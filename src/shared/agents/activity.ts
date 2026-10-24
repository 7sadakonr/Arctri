import { cleanAgentTopic } from './topic';

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * What an agent is doing with one tool call, as a short label for the tab: the description the agent wrote for it, or the file it works on.
 * Never a command, file content or output.
 */
export function activityOf(tool: string, input: unknown): string | undefined {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  let label: string | undefined;
  switch (tool) {
    case 'Bash':
    case 'Agent':
    case 'Task':
      label = str('description');
      break;
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit': {
      const f = str('file_path') ?? str('notebook_path');
      label = f ? `${tool} ${baseName(f)}` : undefined;
      break;
    }
    case 'TodoWrite': {
      const todos = Array.isArray(i['todos']) ? (i['todos'] as Record<string, unknown>[]) : [];
      const doing = todos.find((t) => t?.['status'] === 'in_progress');
      label = typeof doing?.['activeForm'] === 'string' ? (doing['activeForm'] as string) : undefined;
      break;
    }
  }
  return cleanAgentTopic((label ?? tool).replace(/\s+/g, ' '));
}
