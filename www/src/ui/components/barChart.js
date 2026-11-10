import { h, prefersReducedMotion, svg } from '../dom.js';

const WIDTH = 360;
const HEIGHT = 200;
const PADDING = { top: 14, right: 8, bottom: 30, left: 28 };
const MINI = { width: 120, height: 36, padding: { top: 2, right: 1, bottom: 2, left: 1 } };

export function createBarChart({ entries, maxValue, gridValues = [], targetValue, targetLabel, ariaLabel, valueOf, toneOf, labelOf, titleOf, mini = false, axisFormat = String }) {
  const width = mini ? MINI.width : WIDTH;
  const height = mini ? MINI.height : HEIGHT;
  const padding = mini ? MINI.padding : PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slot = plotWidth / entries.length;
  const barWidth = Math.min(18, slot * 0.62);
  const yFor = (value) => padding.top + plotHeight * (1 - Math.min(1, value / maxValue));
  const root = svg('svg', { class: ['bar-chart', mini ? 'is-mini' : null], viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });

  for (const value of gridValues) {
    const y = yFor(value);
    root.append(
      svg('line', { class: 'chart-grid', x1: padding.left, x2: width - padding.right, y1: y, y2: y }),
      svg('text', { class: 'chart-axis', x: padding.left - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: axisFormat(value) }),
    );
  }

  if (Number.isFinite(targetValue)) {
    const y = yFor(targetValue);
    root.append(svg('line', { class: 'chart-target', x1: padding.left, x2: width - padding.right, y1: y, y2: y }));
    if (targetLabel && !mini) root.append(svg('text', { class: 'chart-target-label', x: padding.left + 4, y: y - 5, 'text-anchor': 'start', text: targetLabel }));
  }

  entries.forEach((entry, index) => {
    const value = valueOf(entry);
    const x = padding.left + slot * index + (slot - barWidth) / 2;
    const baseline = padding.top + plotHeight;
    const hasValue = Number.isFinite(value);
    const barHeight = hasValue ? Math.max(mini ? 2 : 3, baseline - yFor(value)) : mini ? 2 : 4;
    root.append(
      svg(
        'rect',
        {
          class: ['chart-bar', `tone-${toneOf(entry)}`],
          x: x.toFixed(2),
          y: (baseline - barHeight).toFixed(2),
          width: barWidth.toFixed(2),
          height: barHeight.toFixed(2),
          rx: Math.min(mini ? 3 : 6, barWidth / 2),
          style: { '--bar-delay': `${index * (mini ? 25 : 45)}ms`, 'transform-origin': `${(x + barWidth / 2).toFixed(2)}px ${baseline}px` },
        },
        titleOf ? svg('title', { text: titleOf(entry) }) : null,
      ),
    );
    const label = mini || !labelOf ? '' : labelOf(entry);
    if (label) root.append(svg('text', { class: ['chart-label', entry.isToday ? 'is-today' : null], x: (x + barWidth / 2).toFixed(2), y: height - 10, 'text-anchor': 'middle', text: label }));
  });

  const element = h('div', { class: ['chart-wrap', mini ? 'chart-wrap-mini' : null] }, root);
  if (prefersReducedMotion()) {
    element.classList.add('is-visible');
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add('is-visible')));
  }
  return { element };
}
