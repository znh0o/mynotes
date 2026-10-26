type Point = { x: number; y: number };
type Tool = 'pen' | 'marker' | 'eraser';
type Stroke = { points: Point[]; color: string; width: number; marker: boolean };

// A small, disposable SVG sketchpad. Deliberately does not import the real editor,
// pen engine or storage, so trying the website never touches an existing notebook.
export function initInstallDemo(root: HTMLElement) {
  const svg = root.querySelector<SVGSVGElement>('.install-demo-surface')!;
  const ink = root.querySelector<SVGGElement>('[data-demo-ink]')!;
  const hint = root.querySelector<HTMLElement>('.install-demo-hint')!;
  const status = root.querySelector<HTMLElement>('[data-demo-status]')!;
  const undo = root.querySelector<HTMLButtonElement>('[data-demo-undo]')!;
  const width = root.querySelector<HTMLInputElement>('#install-demo-width')!;
  let tool: Tool = 'pen', color = '#315ed0';
  let strokes: Stroke[] = [], history: Stroke[][] = [];
  let active: { pointer: number; before: Stroke[]; stroke?: Stroke; path?: SVGPathElement; changed: boolean } | undefined;
  const clone = () => structuredClone(strokes);
  function pathData(points: Point[]) {
    const first = points[0];
    if (points.length === 1) return `M${first.x} ${first.y}l.01 .01`;
    let d = `M${first.x} ${first.y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], next = points[i + 1];
      d += `Q${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
    }
    return `${d}L${points.at(-1)!.x} ${points.at(-1)!.y}`;
  }
  function createPath(stroke: Stroke) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData(stroke.points));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', stroke.marker ? '.3' : '1');
    return path;
  }
  function refresh() {
    ink.replaceChildren(...strokes.map(createPath));
    hint.hidden = strokes.length > 0;
    undo.disabled = history.length === 0;
  }
  function remember(before: Stroke[]) { history.push(before); if (history.length > 20) history.shift(); }
  function point(event: PointerEvent): Point | undefined {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }
  function distanceToSegment(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function erase(p: Point) {
    const kept = strokes.filter(stroke => !stroke.points.some((a, i, points) => distanceToSegment(p, a, points[i + 1] || a) <= 13 + stroke.width / 2));
    if (kept.length === strokes.length) return;
    strokes = kept; active!.changed = true; refresh();
  }
  svg.addEventListener('pointerdown', event => {
    if (active || event.button !== 0) return;
    const p = point(event); if (!p) return;
    event.preventDefault(); svg.setPointerCapture(event.pointerId);
    active = { pointer: event.pointerId, before: clone(), changed: false };
    if (tool === 'eraser') { erase(p); return; }
    if (strokes.length >= 100) { status.textContent = '종이가 가득 찼어요. 전체 지우기로 새로 시작하세요.'; return; }
    const stroke: Stroke = { points: [p], color, width: Number(width.value) * (tool === 'marker' ? 6 : 1), marker: tool === 'marker' };
    active.stroke = stroke; active.path = createPath(stroke); active.changed = true;
    strokes.push(stroke); ink.append(active.path); hint.hidden = true;
  });
  svg.addEventListener('pointermove', event => {
    if (active?.pointer !== event.pointerId) return;
    event.preventDefault();
    for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
      const p = point(sample); if (!p) continue;
      if (tool === 'eraser') { erase(p); continue; }
      if (!active.stroke || active.stroke.points.length >= 2000) continue;
      const last = active.stroke.points.at(-1)!;
      if (Math.hypot(p.x - last.x, p.y - last.y) < .7) continue;
      active.stroke.points.push(p);
    }
    if (active.stroke) active.path?.setAttribute('d', pathData(active.stroke.points));
  });
  function finish(event: PointerEvent) {
    if (active?.pointer !== event.pointerId) return;
    if (event.type === 'pointercancel') strokes = active.before;
    else if (active.changed) { remember(active.before); status.textContent = '다른 색과 도구도 써보세요.'; }
    active = undefined; refresh();
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('lostpointercapture', finish);
  root.querySelectorAll<HTMLButtonElement>('[data-demo-tool]').forEach(button => button.addEventListener('click', () => {
    tool = button.dataset.demoTool as Tool;
    root.querySelectorAll('[data-demo-tool]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    svg.dataset.tool = tool;
    status.textContent = tool === 'eraser' ? '선을 터치하거나 문질러 지워보세요.' : '펜으로 선을 그려보세요.';
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-demo-color]').forEach(button => button.addEventListener('click', () => {
    color = button.dataset.demoColor!;
    root.querySelectorAll('[data-demo-color]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  width.addEventListener('input', () => { root.querySelector<HTMLOutputElement>('.install-demo-foot output')!.value = Number(width.value).toFixed(1); });
  undo.addEventListener('click', () => { const previous = history.pop(); if (previous) strokes = previous; refresh(); status.textContent = '이전 상태로 돌아갔어요.'; });
  root.querySelector('[data-demo-clear]')!.addEventListener('click', () => { if (strokes.length) remember(clone()); strokes = []; refresh(); status.textContent = '새로운 종이를 준비했어요.'; });
}
