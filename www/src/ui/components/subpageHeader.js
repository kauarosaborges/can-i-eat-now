import { h, icon } from '../dom.js';

export function subpageHeader({ title, eyebrow, backHref, backText, backLabel, goBack, actions }) {
  return h(
    'header',
    { class: 'view-header' },
    h(
      'div',
      { class: 'subpage-bar' },
      h(
        'a',
        {
          class: 'back-link',
          href: backHref,
          'aria-label': backLabel,
          onClick: (event) => {
            if (!goBack) return;
            event.preventDefault();
            goBack();
          },
        },
        icon('chevronLeft'),
        h('span', { text: backText }),
      ),
      actions || null,
    ),
    eyebrow ? h('p', { class: 'view-eyebrow', text: eyebrow }) : null,
    h('h1', { class: 'view-title', text: title }),
  );
}
