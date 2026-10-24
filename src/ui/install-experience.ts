/** Presentation only: no editor, canvas engine or note storage is started here. */
export function initInstallExperience(root: HTMLElement) {
  const page = root.querySelector<HTMLElement>('.install-page')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reveals = root.querySelectorAll<HTMLElement>('[data-reveal]');
  // Content stays visible without IntersectionObserver or when motion is reduced.
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        entry.target.classList.toggle('is-visible', entry.isIntersecting && entry.intersectionRatio >= 0.12);
      }
    }, { threshold: 0.12 });
    page.classList.add('install-motion');
    reveals.forEach(element => observer.observe(element));
    reducedMotion.addEventListener('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      page.classList.remove('install-motion');
    });
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  function selectTab(selected: HTMLButtonElement) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!.hidden = !active;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next: number;
      switch (event.key) {
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const target = root.querySelector<HTMLElement>(link.hash);
      if (!target) return;
      event.preventDefault();
      if (link.hash === '#top') window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      else target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  });
}
