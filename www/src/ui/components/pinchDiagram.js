import { t } from '../../i18n/index.js';
import { FOLD_DIRECTIONS } from '../../core/bodyComposition.js';
import { h, svg } from '../dom.js';

const CENTER = { x: 100, y: 75 };

const LABELS = {
  vertical: { thumb: [56, 33, 'middle'], index: [144, 33, 'middle'], distance: [64, 71, 'end'], caliper: [160, 121, 'middle'] },
  diagonal: { thumb: [42, 126, 'middle'], index: [86, 14, 'end'], distance: [88, 116, 'middle'], caliper: [164, 84, 'middle'] },
};

function label([x, y, anchor], text) {
  return svg('text', { class: 'pinch-label', x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle', text });
}

export function createPinchDiagram(site, { named = false } = {}) {
  const direction = FOLD_DIRECTIONS[site] || 'vertical';
  const angle = direction === 'diagonal' ? -45 : 0;
  const name = t(`measure.fold.${direction}`);
  const aria = t('measure.grip.label', { fold: name.toLowerCase() });
  const scene = svg(
    'g',
    { transform: `translate(${CENTER.x} ${CENTER.y}) rotate(${angle})` },
    svg('ellipse', { class: 'pinch-fold', cx: 0, cy: 0, rx: 11, ry: 50 }),
    svg('line', { class: 'pinch-ridge', x1: 0, y1: -44, x2: 0, y2: 44 }),
    svg('polyline', { class: 'pinch-ridge-end', points: '-4,-38 0,-45 4,-38' }),
    svg('polyline', { class: 'pinch-ridge-end', points: '-4,38 0,45 4,38' }),
    svg('rect', { class: 'pinch-finger', x: -74, y: -32, width: 61, height: 16, rx: 8 }),
    svg('rect', { class: 'pinch-finger', x: 13, y: -32, width: 61, height: 16, rx: 8 }),
    svg('path', { class: 'pinch-arm', d: 'M-15 14 V30 H50 M15 14 V22 H50' }),
    svg('rect', { class: 'pinch-caliper', x: 50, y: 16, width: 20, height: 20, rx: 5 }),
    svg('path', { class: 'pinch-jaw', d: 'M-20 1 L-12 8 L-20 15 Z' }),
    svg('path', { class: 'pinch-jaw', d: 'M20 1 L12 8 L20 15 Z' }),
    svg('circle', { class: 'pinch-mark', cx: 0, cy: 8, r: 2.6 }),
    svg('path', { class: 'pinch-dimension', d: 'M-30 -16 V8 M-34 -16 H-26 M-34 8 H-26' }),
  );
  const drawing = svg(
    'svg',
    { class: ['pinch-diagram', `is-${direction}`], viewBox: '0 0 200 150', role: 'img', 'aria-label': aria },
    svg('title', { text: aria }),
    svg('circle', { class: 'pinch-lens', cx: CENTER.x, cy: CENTER.y, r: 70 }),
    scene,
    ...['thumb', 'index', 'distance', 'caliper'].map((part) => label(LABELS[direction][part], t(`measure.grip.${part}`))),
  );
  return h('figure', { class: 'pinch-figure' }, drawing, h('figcaption', { class: 'pinch-caption' }, named ? h('strong', { class: 'pinch-name', text: `${name}: ` }) : null, t(`measure.foldHow.${direction}`)));
}

const STEP_STATES = ['open', 'place', 'release'];
const FOLD_PATH = 'M22 90 C22 72 25 58 34 58 C43 58 46 72 46 90 Z';
const PRESSED_FOLD_PATH = 'M22 90 C22 82 24.5 77 24.5 74 C24.5 70 26 58 34 58 C42 58 43.5 70 43.5 74 C43.5 77 46 82 46 90 Z';

function arrow(from, to, y) {
  const head = to > from ? -4 : 4;
  return svg('path', { class: 'caliper-arrow', d: `M${from} ${y} H${to} M${to + head} ${y - 3} L${to} ${y} L${to + head} ${y + 3}` });
}

function caliperPanel(state) {
  const released = state === 'release';
  const gap = released ? 9.5 : 18;
  const lift = state === 'open' ? -16 : 0;
  const tipY = 74 + lift;
  const barY = 40 + lift;
  const left = 34 - gap;
  const right = 34 + gap;
  const trigger = released ? 62 : 75;
  return svg(
    'svg',
    { class: ['caliper-step-drawing', `is-${state}`], viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'caliper-fold', d: released ? PRESSED_FOLD_PATH : FOLD_PATH }),
    svg('path', { class: 'caliper-skin', d: 'M4 90 H22 M46 90 H96' }),
    svg('path', { class: 'caliper-part', d: `M${left + 3} ${tipY} H${left} V${barY} H80 L86 ${82 + lift}` }),
    svg('path', { class: 'caliper-part is-moving', d: `M${right - 3} ${tipY} H${right} V${barY + 6} H62 L${trigger} ${82 + lift}` }),
    svg('circle', { class: 'caliper-dial', cx: 56, cy: barY - 9, r: 8 }),
    svg('path', { class: 'caliper-needle', d: `M56 ${barY - 9} L${released ? 59 : 62} ${barY - 14}` }),
    released ? null : arrow(64, 73, 77 + lift),
    released ? arrow(72, 63, 90) : null,
    released ? svg('circle', { class: 'caliper-contact', cx: left + 3, cy: tipY, r: 2.4 }) : null,
    released ? svg('circle', { class: 'caliper-contact', cx: right - 3, cy: tipY, r: 2.4 }) : null,
    released ? svg('rect', { class: 'caliper-badge', x: 70, y: 4, width: 26, height: 14, rx: 7 }) : null,
    released ? svg('text', { class: 'caliper-time', x: 83, y: 11.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: t('measure.caliperSteps.seconds') }) : null,
  );
}

export function createCaliperSteps() {
  return h(
    'ol',
    { class: 'caliper-steps', 'aria-label': t('measure.caliperSteps.label') },
    STEP_STATES.map((state) =>
      h(
        'li',
        { class: 'caliper-step' },
        caliperPanel(state),
        h('span', { class: 'caliper-step-text' }, h('strong', { class: 'caliper-step-title', text: t(`measure.caliperSteps.${state}`) }), h('span', { text: t(`measure.caliperSteps.${state}Detail`) })),
      ),
    ),
  );
}
