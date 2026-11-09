import { onFrame } from '../animation.js';
import { cssVar, h, prefersReducedMotion } from '../dom.js';

const BODY_OUTLINE =
  'M88 84C88 93 84 98 74 100C56 103 42 108 36 122C30 138 28 170 26 200L22 256C21 266 34 268 36 258L42 204C44 180 48 162 54 148' +
  'C56 172 58 200 58 228C58 246 56 262 58 280L64 420C64 430 70 434 80 434L90 434C96 434 98 428 97 420L98 302C98 292 102 292 102 302' +
  'L103 420C102 428 104 434 110 434L120 434C130 434 136 430 136 420L142 280C144 262 142 246 142 228C142 200 144 172 146 148' +
  'C152 162 156 180 158 204L164 258C166 268 179 266 178 256L174 200C172 170 170 138 164 122C158 108 144 103 126 100C116 98 112 93 112 84Z';

const SHAPES = {
  body: {
    width: 200,
    height: 450,
    top: 12,
    bottom: 436,
    build() {
      const path = new Path2D(BODY_OUTLINE);
      path.addPath(new Path2D('M64 48a36 36 0 1 0 72 0a36 36 0 1 0 -72 0Z'));
      return path;
    },
  },
  glass: {
    width: 120,
    height: 166,
    top: 14,
    bottom: 156,
    build() {
      return new Path2D('M12 10L108 10L95 150C94 156 90 158 85 158L35 158C30 158 26 156 25 150Z');
    },
  },
};

function readPalette() {
  return {
    shell: cssVar('--vessel-shell', 'rgba(15,94,102,0.08)'),
    stroke: cssVar('--vessel-stroke', 'rgba(15,94,102,0.35)'),
    waterTop: cssVar('--water-light', '#7fd3e6'),
    waterBottom: cssVar('--water-deep', '#1b7f9e'),
    waterBack: cssVar('--water-back', 'rgba(127,211,230,0.55)'),
    bubble: cssVar('--bubble', 'rgba(255,255,255,0.7)'),
  };
}

export function createWaveVessel({ shape = 'body', label = '', className = '' } = {}) {
  const config = SHAPES[shape];
  const canvas = h('canvas', { class: ['vessel-canvas', className], role: 'img', 'aria-label': label });
  const context = canvas.getContext('2d');
  const outline = config.build();
  const reduced = prefersReducedMotion();
  let palette = readPalette();
  let target = 0;
  let level = 0;
  let phase = 0;
  let slosh = 0;
  let sloshClock = 0;
  let bubbles = [];
  let layout = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1, width: 0, height: 0 };
  let stopFrame = null;
  let observer = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const scale = Math.min(rect.width / config.width, rect.height / config.height);
    layout = {
      scale,
      dpr,
      width: rect.width,
      height: rect.height,
      offsetX: (rect.width - config.width * scale) / 2,
      offsetY: (rect.height - config.height * scale) / 2,
    };
    draw();
  }

  function spawnBubble(initial) {
    const surface = levelY();
    const span = config.bottom - surface;
    return {
      x: config.width * (0.25 + Math.random() * 0.5),
      y: initial ? surface + Math.random() * span : config.bottom - 4,
      radius: 1.2 + Math.random() * (shape === 'body' ? 3.2 : 2.4),
      speed: 0.018 + Math.random() * 0.03,
      wobble: Math.random() * Math.PI * 2,
    };
  }

  function levelY() {
    return config.top + (1 - level) * (config.bottom - config.top);
  }

  function waveY(x, y, amplitude, frequency, offset) {
    return y + Math.sin(x * frequency + offset) * amplitude;
  }

  function fillWave(baseY, amplitude, frequency, offset, tilt, fillStyle) {
    context.beginPath();
    context.moveTo(0, config.height + 10);
    for (let x = 0; x <= config.width; x += 4) {
      const tiltOffset = tilt * ((x - config.width / 2) / (config.width / 2));
      const secondary = Math.sin(x * frequency * 2.3 - offset * 0.7) * amplitude * 0.35;
      context.lineTo(x, waveY(x, baseY, amplitude, frequency, offset) + secondary + tiltOffset);
    }
    context.lineTo(config.width, config.height + 10);
    context.closePath();
    context.fillStyle = fillStyle;
    context.fill();
  }

  function draw() {
    if (!layout.width) return;
    const { dpr, scale, offsetX, offsetY } = layout;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
    context.fillStyle = palette.shell;
    context.fill(outline);
    context.save();
    context.clip(outline);
    if (level > 0.001) {
      const surface = levelY();
      const amplitude = (shape === 'body' ? 3.2 : 2.6) + slosh * 9;
      const tilt = slosh * 12 * Math.sin(sloshClock / 170);
      fillWave(surface - 2, amplitude * 0.9, 0.045, phase * 1.25 + 1.7, -tilt * 0.8, palette.waterBack);
      const gradient = context.createLinearGradient(0, surface, 0, config.bottom);
      gradient.addColorStop(0, palette.waterTop);
      gradient.addColorStop(1, palette.waterBottom);
      fillWave(surface, amplitude, 0.034, phase, tilt, gradient);
      context.fillStyle = palette.bubble;
      for (const bubble of bubbles) {
        if (bubble.y < surface + 4) continue;
        context.globalAlpha = 0.35 + 0.4 * Math.min(1, (bubble.y - surface) / 40);
        context.beginPath();
        context.arc(bubble.x + Math.sin(bubble.wobble) * 2.2, bubble.y, bubble.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      const shine = context.createLinearGradient(0, 0, config.width, 0);
      shine.addColorStop(0, 'rgba(255,255,255,0)');
      shine.addColorStop(0.3, 'rgba(255,255,255,0.16)');
      shine.addColorStop(0.42, 'rgba(255,255,255,0)');
      context.fillStyle = shine;
      context.fillRect(0, surface, config.width, config.bottom - surface);
    }
    context.restore();
    context.lineWidth = 2 / Math.max(0.6, scale);
    context.strokeStyle = palette.stroke;
    context.stroke(outline);
  }

  function step(time, delta) {
    const easing = 1 - Math.exp(-delta / 420);
    level += (target - level) * easing;
    if (Math.abs(target - level) < 0.0005) level = target;
    phase += delta * 0.0024;
    sloshClock += delta;
    slosh *= Math.exp(-delta / 900);
    const surface = levelY();
    const wantedBubbles = level > 0.02 ? (shape === 'body' ? 16 : 9) : 0;
    while (bubbles.length < wantedBubbles) bubbles.push(spawnBubble(true));
    if (bubbles.length > wantedBubbles) bubbles.length = wantedBubbles;
    bubbles = bubbles.map((bubble) => {
      const next = { ...bubble, y: bubble.y - bubble.speed * delta, wobble: bubble.wobble + delta * 0.006 };
      return next.y < surface ? spawnBubble(false) : next;
    });
    draw();
  }

  function onThemeChange() {
    palette = readPalette();
    draw();
  }

  const themeQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

  return {
    element: canvas,
    mount() {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      if (themeQuery) themeQuery.addEventListener('change', onThemeChange);
      if (!reduced) stopFrame = onFrame(step);
      resize();
    },
    setLevel(ratio, { slosh: shouldSlosh = false, immediate = false } = {}) {
      target = Math.max(0, Math.min(1, ratio));
      if (immediate || reduced) level = target;
      if (shouldSlosh && !reduced) {
        slosh = 1;
        sloshClock = 0;
      }
      if (reduced) draw();
    },
    setLabel(text) {
      canvas.setAttribute('aria-label', text);
    },
    get displayedLevel() {
      return level;
    },
    destroy() {
      if (stopFrame) stopFrame();
      if (observer) observer.disconnect();
      if (themeQuery) themeQuery.removeEventListener('change', onThemeChange);
    },
  };
}
