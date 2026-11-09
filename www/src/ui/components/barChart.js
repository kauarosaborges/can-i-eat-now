import { h, prefersReducedMotion, svg } from '../dom.js';

const WIDTH = 360;
const HEIGHT = 200;
const PADDING = { top: 14, right: 8, bottom: 30, left: 28 };

export function createBarChart({ entries, maxValue, gridValues, targetValue, targetLabel, ariaLabel, valueOf, toneOf, labelOf, titleOf }) {
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const slot = plotWidth / entries.length;
  const barWidth = Math.min(18, slot * 0.62);
  const yFor = (value) => PADDING.top + plotHeight * (1 - Math.min(1, value / maxValue));
  const root = svg('svg', { class: 'bar-chart', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': ariaLabel });

  for (const value of gridValues) {
    const y = yFor(value);
    root.append(
      svg('line', { class: 'chart-grid', x1: PADDING.left, x2: WIDTH - PADDING.right, y1: y, y2: y }),
      svg('text', { class: 'chart-axis', x: PADDING.left - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: String(value) }),
    );
  }

  if (Number.isFinite(targetValue)) {
    const y = yFor(targetValue);
    root.append(
      svg('line', { class: 'chart-target', x1: PADDING.left, x2: WIDTH - PADDING.right, y1: y, y2: y }),
      svg('text', { class: 'chart-target-label', x: PADDING.left + 4, y: y - 5, 'text-anchor': 'start', text: targetLabel }),
    );
  }

  const bars = [];
  entries.forEach((entry, index) => {
    const value = valueOf(entry);
    const x = PADDING.left + slot * index + (slot - barWidth) / 2;
    const baseline = PADDING.top + plotHeight;
    const hasValue = Number.isFinite(value);
    const height = hasValue ? Math.max(3, baseline - yFor(value)) : 4;
    const bar = svg(
      'rect',
      {
        class: ['chart-bar', `tone-${toneOf(entry)}`],
        x: x.toFixed(2),
        y: (baseline - height).toFixed(2),
        width: barWidth.toFixed(2),
        height: height.toFixed(2),
        rx: Math.min(6, barWidth / 2),
        style: { '--bar-delay': `${index * 45}ms`, 'transform-origin': `${(x + barWidth / 2).toFixed(2)}px ${baseline}px` },
      },
      svg('title', { text: titleOf(entry) }),
    );
    bars.push(bar);
    root.append(
      bar,
      svg('text', { class: ['chart-label', entry.isToday ? 'is-today' : null], x: (x + barWidth / 2).toFixed(2), y: HEIGHT - 10, 'text-anchor': 'middle', text: labelOf(entry) }),
    );
  });

  const element = h('div', { class: 'chart-wrap' }, root);
  if (prefersReducedMotion()) {
    element.classList.add('is-visible');
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add('is-visible')));
  }
  return { element };
}
