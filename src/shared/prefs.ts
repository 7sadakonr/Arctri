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
  scrollback: z.number().int().min(1000).max(200000),
  restoreTabs: z.boolean(),
  conptyMode: z.enum(['bundled', 'inbox']),
  osc52: z.boolean(),
  historyLimit: z.number().int().min(100).max(200000),
  agentPaths: z.record(z.string().max(100), z.string().max(1000)),
  window: z.object(windowShape)
};

export const prefsSchema = z.object({
  language: shape.language.default('auto'),
  theme: shape.theme.default('dark'),
  defaultProfile: shape.defaultProfile,
  defaultPresentation: shape.defaultPresentation.default('blocks'),
  fontSize: shape.fontSize.default(14),
  scrollback: shape.scrollback.default(10000),
  restoreTabs: shape.restoreTabs.default(true),
  conptyMode: shape.conptyMode.default('bundled'),
  osc52: shape.osc52.default(false),
  historyLimit: shape.historyLimit.default(10000),
  agentPaths: shape.agentPaths.default({}),
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
