import { t } from '../../i18n/index.js';
import { h, setText, svg } from '../dom.js';

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 112;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function pointAt(ratio, radius) {
  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius };
}

export function createFastRing() {
  const gradientId = `ring-gradient-${Math.random().toString(36).slice(2, 8)}`;
  const progress = svg('circle', {
    class: 'ring-progress',
    cx: CENTER,
    cy: CENTER,
    r: RADIUS,
    stroke: `url(#${gradientId})`,
    'stroke-dasharray': CIRCUMFERENCE.toFixed(2),
    'stroke-dashoffset': CIRCUMFERENCE.toFixed(2),
    transform: `rotate(-90 ${CENTER} ${CENTER})`,
  });
  const marker = svg('circle', { class: 'ring-head', r: 9, cx: CENTER, cy: CENTER - RADIUS });
  const milestoneLayer = svg('g', { class: 'ring-milestones' });
  const root = svg(
    'svg',
    { class: 'ring-svg', viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' },
    svg(
      'defs',
      null,
      svg(
        'linearGradient',
        { id: gradientId, x1: '0', y1: '0', x2: '1', y2: '1' },
        svg('stop', { offset: '0%', class: 'ring-stop-start' }),
        svg('stop', { offset: '100%', class: 'ring-stop-end' }),
      ),
    ),
    svg('circle', { class: 'ring-track', cx: CENTER, cy: CENTER, r: RADIUS }),
    progress,
    milestoneLayer,
    marker,
  );
  const primary = h('span', { class: 'ring-primary' });
  const caption = h('span', { class: 'ring-caption' });
  const secondary = h('span', { class: 'ring-secondary' });
  const center = h('div', { class: 'ring-center' }, caption, primary, secondary);
  const element = h('div', { class: 'ring', role: 'img' }, root, center);
  let milestoneSignature = '';

  function renderMilestones(milestones) {
    const signature = milestones.map((item) => `${item.ratio.toFixed(4)}:${item.reached}`).join('|');
    if (signature === milestoneSignature) return;
    milestoneSignature = signature;
    while (milestoneLayer.firstChild) milestoneLayer.removeChild(milestoneLayer.firstChild);
    for (const item of milestones) {
      const dot = pointAt(item.ratio, RADIUS);
      const label = pointAt(item.ratio, RADIUS + 26);
      milestoneLayer.append(
        svg('circle', { class: ['ring-milestone', item.reached ? 'is-reached' : null], cx: dot.x.toFixed(2), cy: dot.y.toFixed(2), r: 5 }),
        svg('text', { class: ['ring-milestone-label', item.reached ? 'is-reached' : null], x: label.x.toFixed(2), y: label.y.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: item.label }),
      );
    }
  }

  return {
    element,
    update({ ratio, caption: captionText, primary: primaryText, secondary: secondaryText, milestones = [], tone = 'fasting' }) {
      const safe = Math.max(0, Math.min(1, ratio));
      progress.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - safe)).toFixed(2));
      const head = pointAt(safe, RADIUS);
      marker.setAttribute('cx', head.x.toFixed(2));
      marker.setAttribute('cy', head.y.toFixed(2));
      element.dataset.tone = tone;
      element.setAttribute('aria-label', `${captionText} ${primaryText}. ${t('a11y.ring', { percent: Math.round(safe * 100) })}`);
      setText(caption, captionText);
      setText(primary, primaryText);
      setText(secondary, secondaryText);
      renderMilestones(milestones);
    },
  };
}
