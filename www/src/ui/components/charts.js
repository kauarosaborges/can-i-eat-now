import { h, prefersReducedMotion, svg } from '../dom.js';

const WIDTH = 360;

function reveal(element) {
  if (prefersReducedMotion()) element.classList.add('is-visible');
  else requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add('is-visible')));
  return element;
}

function linePath(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

export function createWeightChart({ series, trend, projection, goalKg, startMs, endMs, todayMs, ariaLabel, formatKg, labels }) {
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 26, left: 36 };
  const values = [...series.map((point) => point.kg), ...trend.map((point) => point.kg), ...projection.map((point) => point.kg)];
  if (Number.isFinite(goalKg)) values.push(goalKg);
  const min = Math.floor((Math.min(...values) - 0.8) * 2) / 2;
  const max = Math.ceil((Math.max(...values) + 0.8) * 2) / 2;
  const x = (ms) => pad.left + ((ms - startMs) / Math.max(1, endMs - startMs)) * (WIDTH - pad.left - pad.right);
  const y = (kg) => pad.top + (1 - (kg - min) / Math.max(0.5, max - min)) * (height - pad.top - pad.bottom);
  const root = svg('svg', { class: 'line-chart', viewBox: `0 0 ${WIDTH} ${height}`, role: 'img', 'aria-label': ariaLabel });
  const steps = 4;
  for (let index = 0; index <= steps; index += 1) {
    const kg = min + ((max - min) * index) / steps;
    root.append(
      svg('line', { class: 'chart-grid', x1: pad.left, x2: WIDTH - pad.right, y1: y(kg), y2: y(kg) }),
      svg('text', { class: 'chart-axis', x: pad.left - 6, y: y(kg), 'text-anchor': 'end', 'dominant-baseline': 'middle', text: formatKg(kg, 1) }),
    );
  }
  if (todayMs >= startMs && todayMs <= endMs) {
    root.append(
      svg('line', { class: 'chart-today', x1: x(todayMs), x2: x(todayMs), y1: pad.top, y2: height - pad.bottom }),
      svg('text', { class: 'chart-label is-today', x: x(todayMs), y: height - 8, 'text-anchor': 'middle', text: labels.today }),
    );
  }
  root.append(
    svg('text', { class: 'chart-label', x: pad.left, y: height - 8, 'text-anchor': 'start', text: labels.start }),
    svg('text', { class: 'chart-label', x: WIDTH - pad.right, y: height - 8, 'text-anchor': 'end', text: labels.end }),
  );
  if (Number.isFinite(goalKg) && goalKg >= min && goalKg <= max) {
    root.append(
      svg('line', { class: 'chart-target', x1: pad.left, x2: WIDTH - pad.right, y1: y(goalKg), y2: y(goalKg) }),
      svg('text', { class: 'chart-target-label', x: pad.left + 4, y: y(goalKg) - 5, text: labels.goal }),
    );
  }
  if (projection.length > 1) {
    root.append(svg('path', { class: 'chart-projection', d: linePath(projection.map((point) => ({ x: x(point.at), y: y(point.kg) }))), pathLength: 1 }));
  }
  if (trend.length > 1) {
    root.append(svg('path', { class: 'chart-trend', d: linePath(trend.map((point) => ({ x: x(point.at), y: y(point.kg) }))), pathLength: 1 }));
  }
  series.forEach((point, index) => {
    root.append(
      svg(
        'circle',
        { class: ['chart-dot', point.source === 'health' ? 'is-health' : null], cx: x(point.at).toFixed(1), cy: y(point.kg).toFixed(1), r: 3.5, style: { '--dot-delay': `${index * 25}ms` } },
        svg('title', { text: point.title }),
      ),
    );
  });
  return { element: reveal(h('div', { class: 'chart-wrap line-chart-wrap' }, root)) };
}

export function createStackedBars({ entries, ariaLabel, labelOf, titleOf, maxValue, layers, markerOf, axisFormat }) {
  const height = 200;
  const pad = { top: 18, right: 8, bottom: 30, left: 34 };
  const plotWidth = WIDTH - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const slot = plotWidth / entries.length;
  const barWidth = Math.min(18, slot * 0.62);
  const baseline = pad.top + plotHeight;
  const scale = (value) => (Math.max(0, value) / Math.max(1, maxValue)) * plotHeight;
  const root = svg('svg', { class: 'bar-chart', viewBox: `0 0 ${WIDTH} ${height}`, role: 'img', 'aria-label': ariaLabel });
  for (const fraction of [0.5, 1]) {
    const yLine = baseline - plotHeight * fraction;
    root.append(
      svg('line', { class: 'chart-grid', x1: pad.left, x2: WIDTH - pad.right, y1: yLine, y2: yLine }),
      svg('text', { class: 'chart-axis', x: pad.left - 6, y: yLine, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: axisFormat(maxValue * fraction) }),
    );
  }
  entries.forEach((entry, index) => {
    const xBar = pad.left + slot * index + (slot - barWidth) / 2;
    let top = baseline;
    const group = svg('g', { class: ['chart-stack', entry.partial ? 'is-partial' : null], style: { '--bar-delay': `${index * 40}ms`, 'transform-origin': `${(xBar + barWidth / 2).toFixed(1)}px ${baseline}px` } }, svg('title', { text: titleOf(entry) }));
    for (const layer of layers) {
      const value = layer.valueOf(entry);
      if (!Number.isFinite(value) || value <= 0) continue;
      const size = scale(value);
      top -= size;
      group.append(svg('rect', { class: ['chart-segment', layer.className], x: xBar.toFixed(1), y: top.toFixed(1), width: barWidth.toFixed(1), height: Math.max(1, size).toFixed(1), rx: 3 }));
    }
    if (markerOf && markerOf(entry)) group.append(svg('circle', { class: 'chart-marker', cx: (xBar + barWidth / 2).toFixed(1), cy: (top - 7).toFixed(1), r: 3.5 }));
    root.append(group, svg('text', { class: ['chart-label', entry.isToday ? 'is-today' : null], x: (xBar + barWidth / 2).toFixed(1), y: height - 10, 'text-anchor': 'middle', text: labelOf(entry) }));
  });
  return { element: reveal(h('div', { class: 'chart-wrap' }, root)) };
}

export function createBalanceBars({ entries, ariaLabel, labelOf, titleOf, valueOf, axisFormat }) {
  const height = 200;
  const pad = { top: 14, right: 8, bottom: 30, left: 40 };
  const plotWidth = WIDTH - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = entries.map(valueOf).filter((value) => Number.isFinite(value));
  const extent = Math.max(300, ...values.map((value) => Math.abs(value)));
  const zero = pad.top + plotHeight / 2;
  const scale = (value) => (Math.abs(value) / extent) * (plotHeight / 2);
  const slot = plotWidth / entries.length;
  const barWidth = Math.min(18, slot * 0.62);
  const root = svg('svg', { class: 'bar-chart', viewBox: `0 0 ${WIDTH} ${height}`, role: 'img', 'aria-label': ariaLabel });
  root.append(
    svg('line', { class: 'chart-zero', x1: pad.left, x2: WIDTH - pad.right, y1: zero, y2: zero }),
    svg('text', { class: 'chart-axis', x: pad.left - 6, y: pad.top + 4, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: axisFormat(extent) }),
    svg('text', { class: 'chart-axis', x: pad.left - 6, y: height - pad.bottom - 4, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: axisFormat(-extent) }),
  );
  entries.forEach((entry, index) => {
    const value = valueOf(entry);
    const xBar = pad.left + slot * index + (slot - barWidth) / 2;
    if (Number.isFinite(value)) {
      const size = Math.max(2, scale(value));
      const deficit = value < 0;
      root.append(
        svg(
          'rect',
          {
            class: ['chart-bar', deficit ? 'tone-deficit' : 'tone-surplus', entry.partial ? 'is-partial' : null],
            x: xBar.toFixed(1),
            y: (deficit ? zero : zero - size).toFixed(1),
            width: barWidth.toFixed(1),
            height: size.toFixed(1),
            rx: 3,
            style: { '--bar-delay': `${index * 40}ms`, 'transform-origin': `${(xBar + barWidth / 2).toFixed(1)}px ${zero}px` },
          },
          svg('title', { text: titleOf(entry) }),
        ),
      );
    }
    root.append(svg('text', { class: ['chart-label', entry.isToday ? 'is-today' : null], x: (xBar + barWidth / 2).toFixed(1), y: height - 10, 'text-anchor': 'middle', text: labelOf(entry) }));
  });
  return { element: reveal(h('div', { class: 'chart-wrap' }, root)) };
}

export function createSparkline({ points, ariaLabel, startMs, endMs }) {
  const width = 120;
  const height = 36;
  const pad = 4;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(0.5, max - min);
  const from = Number.isFinite(startMs) ? startMs : points[0].at;
  const to = Number.isFinite(endMs) ? endMs : points[points.length - 1].at;
  const x = (at) => pad + ((at - from) / Math.max(1, to - from)) * (width - pad * 2);
  const y = (value) => pad + (1 - (value - min) / spread) * (height - pad * 2);
  const coords = points.map((point) => ({ x: points.length === 1 ? width / 2 : x(point.at), y: y(point.value) }));
  const root = svg('svg', { class: 'line-chart spark-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });
  if (coords.length > 1) root.append(svg('path', { class: 'chart-trend spark-line', d: linePath(coords), pathLength: 1 }));
  const last = coords[coords.length - 1];
  root.append(svg('circle', { class: 'chart-dot spark-dot', cx: last.x.toFixed(1), cy: last.y.toFixed(1), r: 3 }));
  return { element: reveal(h('div', { class: 'chart-wrap chart-wrap-mini' }, root)) };
}

export function createStageBar({ segments, ariaLabel }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const bar = h('div', { class: 'stage-bar', role: 'img', 'aria-label': ariaLabel });
  for (const segment of segments) {
    if (!(segment.value > 0) || total <= 0) continue;
    bar.append(h('span', { class: ['stage-bar-segment', segment.className], style: { 'flex-grow': String(segment.value) }, title: segment.title }));
  }
  return { element: reveal(h('div', { class: 'stage-bar-wrap' }, bar)) };
}
