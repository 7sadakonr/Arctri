import { describe, expect, it } from 'vitest';
import { cleanAgentTopic } from './topic';

describe('cleanAgentTopic', () => {
  it('drops the activity glyph in front of the subject', () => {
    expect(cleanAgentTopic('✳ Fix tab status')).toBe('Fix tab status');
    expect(cleanAgentTopic('⠂ Fix tab status')).toBe('Fix tab status');
    expect(cleanAgentTopic('· ✻  Refactor store')).toBe('Refactor store');
    expect(cleanAgentTopic('* Update docs')).toBe('Update docs');
    expect(cleanAgentTopic('◑ การบวกเลขพื้นฐาน 2 + 2')).toBe('การบวกเลขพื้นฐาน 2 + 2');
    expect(cleanAgentTopic('◐ Claude Code')).toBeUndefined();
  });
  it('keeps Thai and mixed text', () => {
    expect(cleanAgentTopic('✳ แก้สถานะของ tab')).toBe('แก้สถานะของ tab');
  });
  it('says nothing for empty or generic titles', () => {
    expect(cleanAgentTopic('')).toBeUndefined();
    expect(cleanAgentTopic('✳')).toBeUndefined();
    expect(cleanAgentTopic('Claude Code')).toBeUndefined();
    expect(cleanAgentTopic('✳ claude')).toBeUndefined();
    expect(cleanAgentTopic('OpenAI Codex')).toBeUndefined();
  });
  it('removes control characters and shortens long titles', () => {
    expect(cleanAgentTopic('A\u0007B\u001b[31mC')).toBe('AB[31mC');
    const long = cleanAgentTopic('x'.repeat(200))!;
    expect([...long].length).toBe(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
