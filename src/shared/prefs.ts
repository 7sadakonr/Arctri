import { z } from 'zod';

const windowShape = {
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(640),
  height: z.number().int().min(400),
  maximized: z.boolean()
};

// The fields without defaults. A patch must not inherit defaults: omitted keys have to stay untouched.
const shape = {
  language: z.enum(['auto', 'en', 'th']),
  theme: z.enum(['dark', 'light']),
  defaultProfile: z.string().max(200).optional(),
  defaultPresentation: z.enum(['blocks', 'classic']),
  fontSize: z.number().int().min(9).max(28),
  uiScale: z.number().min(0.8).max(1.5),
  filePanelWidth: z.number().int().min(200).max(600),
  scrollback: z.number().int().min(1000).max(200000),
  restoreTabs: z.boolean(),
  conptyMode: z.enum(['bundled', 'inbox']),
  osc52: z.boolean(),
  historyLimit: z.number().int().min(100).max(200000),
  agentPaths: z.record(z.string().max(100), z.string().max(1000)),
  agentNotifications: z.boolean(),
  dismissedHints: z.array(z.string().max(100)).max(50),
  recentProjects: z
    .array(
      z.object({
        env: z.enum(['windows', 'wsl']),
        distro: z.string().max(200).optional(),
        path: z.string().max(4096),
        openedAt: z.number()
      })
    )
    .max(20),
  window: z.object(windowShape)
};

export const prefsSchema = z.object({
  language: shape.language.default('auto'),
  theme: shape.theme.default('dark'),
  defaultProfile: shape.defaultProfile,
  defaultPresentation: shape.defaultPresentation.default('blocks'),
  fontSize: shape.fontSize.default(14),
  uiScale: shape.uiScale.default(1.1),
  filePanelWidth: shape.filePanelWidth.default(280),
  scrollback: shape.scrollback.default(10000),
  restoreTabs: shape.restoreTabs.default(true),
  conptyMode: shape.conptyMode.default('bundled'),
  osc52: shape.osc52.default(false),
  historyLimit: shape.historyLimit.default(10000),
  agentPaths: shape.agentPaths.default({}),
  agentNotifications: shape.agentNotifications.default(true),
  dismissedHints: shape.dismissedHints.default([]),
  recentProjects: shape.recentProjects.default([]),
  window: z
    .object({
      ...windowShape,
      width: windowShape.width.default(1100),
      height: windowShape.height.default(700),
      maximized: windowShape.maximized.default(false)
    })
    .default({ width: 1100, height: 700, maximized: false })
});

/** Validates a partial update coming from the renderer; only the keys that were sent are present. */
export const prefsPatchSchema = z.object(shape).partial();

export type Prefs = z.infer<typeof prefsSchema>;
export const defaultPrefs = (): Prefs => prefsSchema.parse({});
