const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') {
      element.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (name === 'text') {
      element.textContent = value;
    } else if (name === 'style' && typeof value === 'object') {
      for (const [property, styleValue] of Object.entries(value)) element.style.setProperty(property, styleValue);
    } else if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
}

function appendChildren(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, attributes, ...children) {
  const element = document.createElement(tag);
  applyAttributes(element, attributes);
  appendChildren(element, children);
  return element;
}

export function svg(tag, attributes, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  applyAttributes(element, attributes);
  appendChildren(element, children);
  return element;
}

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function pressable(element) {
  element.classList.add('pressable');
  return element;
}

export function icon(name) {
  const paths = ICONS[name] || [];
  return svg(
    'svg',
    { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    paths.map((d) => svg('path', { d })),
  );
}

const ICONS = {
  today: ['M12 3v2', 'M12 19v2', 'M5 12H3', 'M21 12h-2', 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z', 'M6.3 6.3l1.4 1.4', 'M16.3 16.3l1.4 1.4', 'M6.3 17.7l1.4-1.4', 'M16.3 7.7l1.4-1.4'],
  water: ['M12 3c3.5 4.2 6 7.6 6 10.6A6 6 0 0 1 6 13.6C6 10.6 8.5 7.2 12 3z', 'M9.2 14.2a2.8 2.8 0 0 0 2.8 2.8'],
  history: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
  fork: ['M7 3v8', 'M4 3v5a3 3 0 0 0 6 0V3', 'M7 11v10', 'M17 3c-2 0-3 2-3 6s1 5 3 5v7'],
  skip: ['M6 6l8 6l-8 6z', 'M18 6v12'],
  flame: ['M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5c0 2 1 3 2 3c0-3-1-5 1-8.5z'],
  info: ['M12 8h.01', 'M11 12h1v5h1', 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z'],
  body: ['M12 4a2.5 2.5 0 1 0 0.01 0', 'M7 21l1.5-8.5L6 9.5', 'M17 21l-1.5-8.5L18 9.5', 'M8.5 12.5h7', 'M6 9.5c2-1 4-1.5 6-1.5s4 .5 6 1.5'],
  clock: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  bed: ['M3 18V7', 'M3 13h18v5', 'M21 13a3 3 0 0 0-3-3h-7v3', 'M7 10.5a1.5 1.5 0 1 0 0.01 0'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  pulse: ['M3 12h4l2-5l4 10l2-5h6'],
  walk: ['M13 3.5a1.5 1.5 0 1 0 0.01 0', 'M10 21l2-6l-2-3l1-4l4 3h3', 'M11 8l-3 2v3', 'M12 15l3 2v4'],
  route: ['M6 17a2 2 0 1 0 0.01 0', 'M18 3a2 2 0 1 0 0.01 0', 'M6 17V9a3 3 0 0 1 6 0v6a3 3 0 0 0 6 0V5'],
  bolt: ['M13 3L5 14h6l-1 7l8-11h-6z'],
  dumbbell: ['M6 8v8', 'M18 8v8', 'M3 10.5v3', 'M21 10.5v3', 'M6 12h12'],
  scale: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8.5 10a5 5 0 0 1 7 0', 'M12 10l1.5-1.5'],
  chevronRight: ['M9 6l6 6l-6 6'],
  chevronLeft: ['M15 6l-6 6l6 6'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  ruler: ['M3 16L16 3l5 5L8 21z', 'M7 12l2 2', 'M10 9l2 2', 'M13 6l2 2'],
  download: ['M12 4v11', 'M7 10l5 5l5-5', 'M5 20h14'],
  book: ['M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z', 'M5 18a2 2 0 0 1 2-2h12', 'M9 8h6'],
};
