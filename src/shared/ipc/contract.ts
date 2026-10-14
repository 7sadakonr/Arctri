import { z } from 'zod';
import { prefsPatchSchema } from '../prefs';

const envPath = z.union([
  z.object({ env: z.literal('windows'), path: z.string().max(4096) }),
  z.object({ env: z.literal('wsl'), distro: z.string().max(200), path: z.string().max(4096) }),
  z.object({ env: z.literal('local'), path: z.string().max(4096) })
]);

const launchOptions = z.object({
  resume: z.enum(['last', 'picker']).optional(),
  model: z.string().max(200).optional(),
  permissionMode: z.string().max(100).optional(),
  extraArgs: z.array(z.string().max(1000)).max(50).optional()
});

export const sessionSpecSchema = z.object({
  profileId: z.string().min(1).max(200),
  kind: z.enum(['shell', 'agent']),
  cwd: envPath.optional(),
  agent: z.object({ adapterId: z.enum(['claude-code', 'codex']), options: launchOptions }).optional(),
  presentation: z.enum(['blocks', 'classic']).optional(),
  title: z.string().max(80).optional(),
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(1000)
});

const id = z.string().min(1).max(100);

/** Request schemas for every invoke/send channel. The main process validates all of them. */
export const requestSchemas = {
  'profiles:list': z.object({ refreshWsl: z.boolean().optional(), waitWsl: z.boolean().optional() }).optional(),
  'session:create': sessionSpecSchema,
  'session:close': z.object({ id }),
  'session:rename': z.object({ id, title: z.string().max(80) }),
  'session:resize': z.object({ id, cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(1000) }),
  'session:submit': z.object({ id, command: z.string().max(100_000) }),
  'session:write': z.object({ id, data: z.string().max(1_000_000) }),
  'session:ack': z.object({ id, length: z.number().int().min(0).max(1e9) }),
  'session:list': z.undefined().or(z.null()),
  'session:saved': z.undefined().or(z.null()),
  'prefs:get': z.undefined().or(z.null()),
  'prefs:set': prefsPatchSchema,
  'history:search': z.object({ sessionId: id, prefix: z.string().max(1000), limit: z.number().int().min(1).max(500) }),
  'history:clear': z.undefined().or(z.null()),
  'completion:query': z.object({
    requestId: z.number().int(), sessionId: id, line: z.string().max(10_000), cursor: z.number().int().min(0).max(10_000)
  }),
  'agents:detect': z.object({ refresh: z.boolean().optional() }).optional(),
  'git:status': z.object({ sessionId: id }),
  'fs:read': z.object({ sessionId: id, rel: z.string().min(1).max(4096) }),
  'fs:readImage': z.object({ sessionId: id, rel: z.string().min(1).max(4096) }),
  'fs:write': z.object({
    sessionId: id, rel: z.string().min(1).max(4096), text: z.string().max(5_500_000),
    eol: z.enum(['lf', 'crlf']), bom: z.boolean(), expectMtimeMs: z.number().optional()
  }),
  'fs:stat': z.object({ sessionId: id, rel: z.string().min(1).max(4096) }),
  'git:changes': z.object({ sessionId: id }),
  'fs:list': z.object({ sessionId: id, rel: z.string().max(4096) }),
  'app:pickFiles': z.object({ sessionId: id }),
  'app:pickFolder': z.undefined().or(z.null()),
  'git:headText': z.object({ sessionId: id, rel: z.string().min(1).max(4096) }),
  'git:refs': z.object({ sessionId: id }),
  'git:stage': z.object({ sessionId: id, paths: z.union([z.literal('all'), z.array(z.string().min(1).max(4096)).min(1).max(5000)]) }),
  'git:unstage': z.object({ sessionId: id, paths: z.union([z.literal('all'), z.array(z.string().min(1).max(4096)).min(1).max(5000)]) }),
  'git:commit': z.object({ sessionId: id, message: z.string().min(1).max(10_000) }),
  'git:createBranch': z.object({ sessionId: id, name: z.string().min(1).max(200) }),
  'git:branchPreflight': z.object({ sessionId: id }),
  'git:push': z.object({ sessionId: id }),
  'git:fetch': z.object({ sessionId: id }),
  'git:pull': z.object({ sessionId: id }),
  'git:switch': z.object({ sessionId: id, name: z.string().min(1).max(200), remote: z.boolean() }),
  'git:log': z.object({ sessionId: id, limit: z.number().int().min(1).max(500) }),
  'git:commitFiles': z.object({ sessionId: id, hash: z.string().regex(/^[0-9a-f]{7,40}$/) }),
  'git:revText': z.object({
    sessionId: id, rel: z.string().min(1).max(4096), rev: z.string().regex(/^[0-9a-f]{7,40}\^?$/)
  }),
  'agents:codexNotifications': z.object({ sessionId: id, action: z.enum(['status', 'enable']) }),
  'agentStatus:list': z.undefined().or(z.null()),
  'agentStatus:signal': z.object({ sessionId: id }),
  'agentStatus:active': z.object({ sessionId: id.nullable() }),
  'agentStatus:input': z.object({ sessionId: id, kind: z.enum(['any', 'interrupt']).optional() }),
  'agentStatus:markRead': z.object({ sessionId: id.or(z.literal('all')) }),
  'app:notify': z.object({ sessionId: id, title: z.string().max(200), body: z.string().max(1000) }),
  'app:diagnostics': z.undefined().or(z.null()),
  'app:openExternal': z.object({ url: z.string().max(2000) }),
  'app:openPath': z.object({ sessionId: id })
} as const;

export type RequestChannel = keyof typeof requestSchemas;
export type Req<C extends RequestChannel> = z.infer<(typeof requestSchemas)[C]>;

export const eventChannels = ['session:changed', 'session:closed', 'session:port', 'app:menu', 'app:focus-session', 'agentStatus:changed'] as const;
export type EventChannel = (typeof eventChannels)[number];
