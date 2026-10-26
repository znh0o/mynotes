import './style.css';
import './theme.css';
import './dark.css';
import './phone.css';
import './landing.css';
import { installFastTaps } from './ui/tool-taps';
import { initAppearance } from './ui/appearance';
import { renderInstallPage } from './ui/install-page';
import { isNativeApp } from './platform/native';

const root = document.querySelector<HTMLElement>('#app')!;
initAppearance();
const appMode = isNativeApp || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;
installFastTaps();
// Display mode chooses the UI only. It is not proof of installation or an auth boundary.
if (appMode) {
  void import('./main').catch(error => {
    console.error('Notelin failed to start', error);
    root.innerHTML = '<div class="boot-error"><h1>Notelin을 열지 못했어요.</h1><p>앱을 다시 실행해 주세요.</p></div>';
  });
} else {
  renderInstallPage(root);
}
// Choose the route at launch only; fullscreen changes must not close an open note.
