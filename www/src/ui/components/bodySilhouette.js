import { svg } from '../dom.js';
import { FOLD_DIRECTIONS } from '../../core/bodyComposition.js';

const FULL = { width: 120, height: 252 };
const CROP = { width: 66, height: 84 };

const OUTLINES = {
  male: [
    [54, 35], [53, 44], [41, 48], [32, 54], [28, 70], [25, 96], [22, 122], [20, 133], [27, 136], [30, 123], [33, 98], [36, 76], [39, 64],
    [40, 82], [41, 98], [39, 112], [37, 128], [39, 160], [43, 196], [44, 224], [41, 232], [56, 232], [56, 200], [57, 162], [60, 142],
  ],
  female: [
    [55, 35], [54, 44], [43, 48], [35, 54], [31, 70], [28, 96], [25, 122], [23, 133], [30, 136], [33, 123], [35, 98], [38, 76], [40, 64],
    [42, 82], [44, 98], [39, 114], [35, 130], [38, 160], [43, 196], [44, 224], [41, 232], [56, 232], [56, 200], [57, 162], [60, 144],
  ],
};

export const SITE_MARKERS = {
  skinfold: {
    chest: { view: 'front', kind: 'point', x: 45, y: 60 },
    midaxillary: { view: 'front', kind: 'point', x: 41, y: 84 },
    triceps: { view: 'back', kind: 'point', x: 93, y: 78 },
    subscapular: { view: 'back', kind: 'point', x: 71, y: 72 },
    abdomen: { view: 'front', kind: 'point', x: 54, y: 104 },
    suprailiac: { view: 'front', kind: 'point', x: 44, y: 114 },
    thigh: { view: 'front', kind: 'point', x: 48, y: 160 },
    calf: { view: 'front', kind: 'point', x: 55, y: 198 },
  },
  girth: {
    neck: { view: 'front', kind: 'band', x1: 52, x2: 68, y: 41 },
    chest: { view: 'front', kind: 'band', x1: 37, x2: 83, y: 64 },
    waist: { view: 'front', kind: 'band', x1: 40, x2: 80, y: 102 },
    hip: { view: 'front', kind: 'band', x1: 36, x2: 84, y: 130 },
    armRelaxed: { view: 'front', kind: 'band', x1: 27, x2: 38, y: 76 },
    armFlexed: { view: 'front', kind: 'band', x1: 27, x2: 38, y: 74 },
    forearm: { view: 'front', kind: 'band', x1: 24, x2: 33, y: 104 },
    thigh: { view: 'front', kind: 'band', x1: 39, x2: 59, y: 160 },
    calf: { view: 'front', kind: 'band', x1: 42, x2: 57, y: 196 },
  },
};

function outlinePoints(sex) {
  const left = OUTLINES[sex] || OUTLINES.male;
  const right = [...left].reverse().slice(1).map(([x, y]) => [FULL.width - x, y]);
  return [...left, ...right];
}

function smoothPath(points) {
  const count = points.length;
  const at = (index) => points[(index + count) % count];
  let d = `M${at(0)[0]} ${at(0)[1]}`;
  for (let index = 0; index < count; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6];
    const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x2} ${y2}`;
  }
  return `${d} Z`;
}

const PATHS = { male: smoothPath(outlinePoints('male')), female: smoothPath(outlinePoints('female')) };

function figure(view, sex) {
  const details = view === 'back'
    ? [
        svg('path', { class: 'silhouette-detail', d: 'M60 48 L60 118' }),
        svg('path', { class: 'silhouette-detail', d: 'M50 58 Q46 68 52 76' }),
        svg('path', { class: 'silhouette-detail', d: 'M70 58 Q74 68 68 76' }),
      ]
    : [
        svg('circle', { class: 'silhouette-detail-dot', cx: 60, cy: 104, r: 1.2 }),
        svg('path', { class: 'silhouette-detail', d: 'M44 112 Q50 118 56 122' }),
        svg('path', { class: 'silhouette-detail', d: 'M76 112 Q70 118 64 122' }),
        sex === 'female' ? svg('path', { class: 'silhouette-detail', d: 'M44 66 Q50 72 56 66 M64 66 Q70 72 76 66' }) : svg('path', { class: 'silhouette-detail', d: 'M46 64 h0.1 M74 64 h0.1' }),
      ];
  return [svg('circle', { class: 'silhouette-body', cx: 60, cy: 21, r: 13 }), svg('path', { class: 'silhouette-body', d: PATHS[sex] || PATHS.male }), ...details];
}

function marker(spec, direction) {
  if (spec.kind === 'band') {
    return [
      svg('line', { class: 'silhouette-band-glow', x1: spec.x1 - 2, x2: spec.x2 + 2, y1: spec.y, y2: spec.y }),
      svg('line', { class: 'silhouette-band', x1: spec.x1 - 2, x2: spec.x2 + 2, y1: spec.y, y2: spec.y }),
    ];
  }
  const fold = direction === 'diagonal'
    ? svg('line', { class: 'silhouette-fold', x1: spec.x - 5, y1: spec.y - 5, x2: spec.x + 5, y2: spec.y + 5 })
    : svg('line', { class: 'silhouette-fold', x1: spec.x, y1: spec.y - 7, x2: spec.x, y2: spec.y + 7 });
  return [fold, svg('circle', { class: 'silhouette-ring', cx: spec.x, cy: spec.y, r: 6 }), svg('circle', { class: 'silhouette-point', cx: spec.x, cy: spec.y, r: 2.6 })];
}

export function cropBox(spec) {
  if (!spec) return { x: 0, y: 0, width: FULL.width, height: FULL.height };
  const cx = spec.kind === 'band' ? (spec.x1 + spec.x2) / 2 : spec.x;
  const width = spec.kind === 'band' ? Math.max(CROP.width, spec.x2 - spec.x1 + 20) : CROP.width;
  const height = Math.round((width * CROP.height) / CROP.width);
  const x = Math.min(Math.max(0, cx - width / 2), FULL.width - width);
  const y = Math.min(Math.max(0, spec.y - height / 2), FULL.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height };
}

export function createSilhouette({ kind, site, label, sex = 'male', zoom = true }) {
  const spec = SITE_MARKERS[kind] && SITE_MARKERS[kind][site];
  const view = spec ? spec.view : 'front';
  const box = zoom ? cropBox(spec) : { x: 0, y: 0, ...FULL };
  return svg(
    'svg',
    { class: ['silhouette', `is-${view}`, zoom ? 'is-zoomed' : null], viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`, role: 'img', 'aria-label': label },
    svg('title', { text: label }),
    ...figure(view, sex === 'female' ? 'female' : 'male'),
    ...(spec ? marker(spec, kind === 'skinfold' ? FOLD_DIRECTIONS[site] : null) : []),
  );
}

export function siteView(kind, site) {
  const spec = SITE_MARKERS[kind] && SITE_MARKERS[kind][site];
  return spec ? spec.view : 'front';
}
