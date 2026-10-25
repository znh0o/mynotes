import { describe, expect, it } from 'vitest';
import { deviceUI } from '../src/ui/device-ui';

describe('device UI', () => {
  it('keeps Galaxy Tab and iPad layouts on tablets, even in split view', () => {
    expect(deviceUI({ width: 390, userAgent: 'Mozilla/5.0 (Linux; Android 10; K) SamsungBrowser/30.0', touchPoints: 10 })).toBe('tablet');
    expect(deviceUI({ width: 600, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X920) AppleWebKit', touchPoints: 10, mobile: false })).toBe('tablet');
    expect(deviceUI({ width: 430, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_1) AppleWebKit', touchPoints: 5 })).toBe('tablet');
  });

  it('keeps phone chrome in landscape and allows narrow desktop previews', () => {
    expect(deviceUI({ width: 900, userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/123', touchPoints: 5, mobile: true })).toBe('phone');
    expect(deviceUI({ width: 390, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/143', touchPoints: 0 })).toBe('phone');
    expect(deviceUI({ width: 800, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/143', touchPoints: 0 })).toBe('tablet');
  });
});
