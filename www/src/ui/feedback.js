import { t } from '../i18n/index.js';
import { clear, h, icon, pressable } from './dom.js';

const TOAST_DURATION = 4200;
const TOAST_ACTION_DURATION = 6500;

let region = null;

function toastRegion() {
  if (!region) {
    region = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}

export function showToast(message, options = {}) {
  const container = toastRegion();
  let timer = null;
  const toast = h('div', { class: ['toast', options.tone ? `toast-${options.tone}` : null] });
  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  };
  toast.append(h('p', { class: 'toast-text', text: message }));
  if (options.action) {
    toast.append(
      pressable(
        h('button', {
          type: 'button',
          class: 'toast-action',
          text: options.action.label,
          onClick: (event) => {
            event.currentTarget.disabled = true;
            options.action.onClick();
            dismiss();
          },
        }),
      ),
    );
  }
  toast.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': t('a11y.closeToast'), onClick: dismiss }, icon('close')));
  container.append(toast);
  while (container.children.length > 3) container.firstElementChild.remove();
  const duration = options.duration === undefined ? (options.action ? TOAST_ACTION_DURATION : TOAST_DURATION) : options.duration;
  if (duration !== null) timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function openOverlay({ className, content, onClose, labelledBy }) {
  const previousFocus = document.activeElement;
  const panel = h('div', { class: ['overlay-panel', className], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy || null, tabindex: '-1' }, content);
  const backdrop = h('div', { class: 'overlay' }, panel);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('is-leaving');
    setTimeout(() => backdrop.remove(), 260);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (onClose) onClose(result);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close(false);
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close(false);
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => {
    const focusTarget = panel.querySelector('[data-autofocus]') || panel;
    focusTarget.focus();
  });
  return { close, panel };
}

export function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const titleId = `dialog-title-${Date.now()}`;
    let overlay = null;
    const content = [
      h('h2', { id: titleId, class: 'dialog-title', text: title }),
      h('p', { class: 'dialog-body', text: body }),
      h(
        'div',
        { class: 'dialog-actions' },
        pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('common.cancel'), 'data-autofocus': true, onClick: () => overlay.close(false) })),
        pressable(h('button', { type: 'button', class: ['button', danger ? 'button-danger' : 'button-primary'], text: confirmLabel, onClick: () => overlay.close(true) })),
      ),
    ];
    overlay = openOverlay({ className: 'dialog', content, labelledBy: titleId, onClose: (result) => resolve(result === true) });
  });
}

export function replaceContent(element, ...children) {
  clear(element);
  element.append(...children.flat().filter(Boolean));
}
