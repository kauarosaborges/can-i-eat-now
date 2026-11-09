import { t } from '../../i18n/index.js';
import { h, pressable } from '../dom.js';
import { openOverlay } from '../feedback.js';
import { formatMl } from '../format.js';
import { createWaveVessel } from './waveVessel.js';

let active = null;

export function showReminderPrompt({ ml, onDrink }) {
  if (active) return;
  const glass = createWaveVessel({ shape: 'glass', className: 'reminder-glass', label: t('water.glassLabel') });
  const titleId = 'reminder-title';
  let overlay = null;
  let fillTimer = null;
  let drank = false;
  const content = [
    h('div', { class: 'reminder-visual' }, h('span', { class: 'reminder-halo', 'aria-hidden': 'true' }), glass.element),
    h('h2', { class: 'reminder-title', id: titleId, text: t('reminder.title') }),
    h('p', { class: 'reminder-body', text: t('reminder.body', { amount: formatMl(ml) }) }),
    h(
      'div',
      { class: 'dialog-actions' },
      pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('reminder.later'), onClick: () => overlay.close(false) })),
      pressable(
        h('button', {
          type: 'button',
          class: 'button button-water',
          'data-autofocus': true,
          text: t('reminder.drink', { amount: formatMl(ml) }),
          onClick: (event) => {
            if (drank) return;
            drank = true;
            event.currentTarget.disabled = true;
            glass.setLevel(0.02, { slosh: true });
            onDrink(ml);
            setTimeout(() => overlay.close(true), 650);
          },
        }),
      ),
    ),
  ];
  overlay = openOverlay({
    className: 'reminder-panel',
    content,
    labelledBy: titleId,
    onClose: () => {
      clearTimeout(fillTimer);
      glass.destroy();
      active = null;
    },
  });
  active = overlay;
  glass.mount();
  glass.setLevel(0, { immediate: true });
  fillTimer = setTimeout(() => glass.setLevel(0.82, { slosh: true }), 250);
}
