// The app chrome stays at device scale. The paper viewport handles its own
// two-finger / Ctrl-wheel zoom without scaling menus or the home screen.
export function installAppZoomGuard() {
  document.addEventListener('wheel', event => {
    if ((event.ctrlKey || event.metaKey) && !(event.target as Element).closest('.paper-viewport')) event.preventDefault();
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
  });
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
}
