// The app chrome stays at device scale. The paper viewport handles its own
// two-finger / Ctrl-wheel zoom without scaling menus or the home screen.
export function installAppZoomGuard() {
  let multiTouch = false;
  const blockNativePinch = (event: TouchEvent) => {
    if (event.touches.length > 1) multiTouch = true;
    if (multiTouch && event.cancelable) event.preventDefault();
  };
  // Some Android browser/accessibility settings override viewport restrictions.
  // Cancel the native gesture as well; paper zoom still uses Pointer Events.
  document.addEventListener('touchstart', blockNativePinch, { capture: true, passive: false });
  document.addEventListener('touchmove', blockNativePinch, { capture: true, passive: false });
  const end = (event: TouchEvent) => {
    if (multiTouch && event.cancelable) event.preventDefault();
    if (!event.touches.length) multiTouch = false;
  };
  document.addEventListener('touchend', end, { capture: true, passive: false });
  document.addEventListener('touchcancel', end, { capture: true, passive: false });
  document.addEventListener('wheel', event => {
    if ((event.ctrlKey || event.metaKey) && !(event.target as Element).closest('.paper-viewport')) event.preventDefault();
  }, { capture: true, passive: false });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
  });
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
}
