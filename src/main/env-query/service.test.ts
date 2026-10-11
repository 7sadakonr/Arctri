import { describe, expect, it } from 'vitest';
import { drvfsToWindows } from './service';

describe('drvfsToWindows', () => {
  it('maps a Windows drive seen from WSL back to its Windows path', () => {
    expect(drvfsToWindows('/mnt/d/Desktop/Arctri')).toBe('D:\\Desktop\\Arctri');
    expect(drvfsToWindows('/mnt/c')).toBe('C:\\');
    expect(drvfsToWindows('/home/me/proj')).toBeUndefined();
    expect(drvfsToWindows('/mnt/wsl/x')).toBeUndefined();
  });
});
