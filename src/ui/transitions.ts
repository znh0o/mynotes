import type { Direction } from './history';
let cleanup: (() => void) | undefined;
export function finishSlide() { cleanup?.(); cleanup = undefined; }
export function slidePreviousView(root: HTMLElement, previous: Element | null, direction: Direction, scrollY = 0) {
  finishSlide();
  if (!previous || previous === root.firstElementChild || direction === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
  const layer = document.createElement('div'); layer.className = 'app-slide-layer'; layer.dataset.direction = direction;
  layer.inert = true; layer.setAttribute('aria-hidden', 'true');
  previous.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  const sidebar = previous.querySelector<HTMLElement>('.library-sidebar');
  if (sidebar) { sidebar.style.position = 'absolute'; sidebar.style.top = `${scrollY}px`; sidebar.style.bottom = 'auto'; sidebar.style.height = '100dvh'; }
  const content = document.createElement('div'); content.style.transform = `translateY(${-scrollY}px)`;
  content.append(previous); layer.append(content); document.body.append(layer);
  const animation = layer.animate(direction === 'back' ? [
    { transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(100%)', opacity: .75 }
  ] : [
    { transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-20%)', opacity: 0 }
  ], { duration: direction === 'back' ? 260 : 180, easing: 'cubic-bezier(.22,.7,.2,1)', fill: 'forwards' });
  const timer = setTimeout(() => finish(), 400);
  const finish = () => { clearTimeout(timer); animation.cancel(); layer.remove(); if (cleanup === finish) cleanup = undefined; };
  cleanup = finish; void animation.finished.then(finish, finish);
}
