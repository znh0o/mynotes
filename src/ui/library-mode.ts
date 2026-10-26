import { icon } from './common';

export type LibraryMode = 'classic' | 'bookshelf';

export function libraryModeSwitch(active: LibraryMode) {
  return `<div class="library-mode-switch" role="group" aria-label="서재 보기 방식"><button type="button" data-action="library-mode" data-id="classic" aria-pressed="${active === 'classic'}" title="목록 보기">${icon('Grid2X2', 16)}<span>목록</span></button><button type="button" data-action="library-mode" data-id="bookshelf" aria-pressed="${active === 'bookshelf'}" title="책장 보기">${icon('Library', 16)}<span>책장</span></button></div>`;
}
