export interface DeviceContext { width: number; userAgent: string; touchPoints: number; mobile?: boolean }
export function deviceUI({ width, userAgent, touchPoints, mobile }: DeviceContext): 'phone' | 'tablet' {
  if (/iPad|Tablet|SM-[TX]/i.test(userAgent) || /Macintosh/.test(userAgent) && touchPoints > 1) return 'tablet';
  if (mobile === true || /iPhone|iPod|Android.*Mobile/i.test(userAgent)) return 'phone';
  // Android tablets often use a reduced UA without a model or Android version.
  if (/Android/i.test(userAgent)) return 'tablet';
  return width <= 600 ? 'phone' : 'tablet';
}
export const isPhoneUI = () => document.documentElement.dataset.deviceUi === 'phone';
export function installDeviceUI() {
  const apply = () => {
    const hint = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    const next = deviceUI({ width: innerWidth, userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints, mobile: hint.userAgentData?.mobile });
    if (document.documentElement.dataset.deviceUi === next) return;
    document.documentElement.dataset.deviceUi = next;
    window.dispatchEvent(new Event('notelin-device-ui'));
  };
  matchMedia('(max-width: 600px)').addEventListener('change', apply);
  apply();
}
