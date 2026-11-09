import { t } from '../../i18n/index.js';
import { clear, h, icon, pressable, prefersReducedMotion, setText } from '../dom.js';
import { mergeSettings } from '../../core/storage.js';
import { mealsEditor, modeDetails, modePicker, notificationControl, profileFields } from '../forms.js';
import { permissionState } from '../notifications.js';

export function openOnboarding({ store, onDone, onCancel, canCancel }) {
  const draft = store.snapshot();
  if (permissionState() === 'granted') draft.notifications.enabled = true;
  let currentMeals = null;
  const commit = (reason) => {
    if (currentMeals && (reason === 'fasting' || reason === 'mode')) currentMeals.refreshWarnings();
  };
  const steps = [
    { title: 'onboarding.modeTitle', subtitle: 'onboarding.modeSubtitle', build: () => modePicker(draft, commit) },
    {
      title: 'onboarding.scheduleTitle',
      subtitle: 'onboarding.scheduleSubtitle',
      build: () => {
        currentMeals = mealsEditor(draft, commit);
        return h('div', { class: 'stack' }, modeDetails(draft, commit).element, h('hr', { class: 'divider' }), currentMeals.element);
      },
    },
    { title: 'onboarding.hydrationTitle', subtitle: 'onboarding.hydrationSubtitle', build: () => profileFields(draft, commit) },
    { title: 'onboarding.notificationsTitle', subtitle: 'onboarding.notificationsSubtitle', build: () => notificationControl(draft, commit) },
  ];

  let index = 0;
  const progressBar = h('span', { class: 'onboarding-progress-bar' });
  const stepLabel = h('p', { class: 'onboarding-step' });
  const title = h('h1', { class: 'onboarding-title', id: 'onboarding-title', tabindex: '-1' });
  const subtitle = h('p', { class: 'onboarding-subtitle' });
  const body = h('div', { class: 'onboarding-body' });
  const backButton = pressable(h('button', { type: 'button', class: 'button button-ghost', onClick: () => go(index - 1) }, t('common.back')));
  const nextButton = pressable(h('button', { type: 'button', class: 'button button-primary button-large', onClick: () => (index === steps.length - 1 ? finish() : go(index + 1)) }));
  const panel = h(
    'div',
    { class: 'onboarding-panel' },
    h(
      'div',
      { class: 'onboarding-brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('water')),
      h('span', { class: 'onboarding-brand-name', text: t('app.name') }),
      canCancel ? pressable(h('button', { type: 'button', class: 'icon-button onboarding-close', 'aria-label': t('onboarding.cancel'), onClick: () => cancel() }, icon('close'))) : null,
    ),
    h('div', { class: 'onboarding-progress', 'aria-hidden': 'true' }, progressBar),
    stepLabel,
    h('div', { class: 'onboarding-stage' }, h('div', { class: 'onboarding-step-content' }, title, subtitle, body)),
    h('div', { class: 'onboarding-actions' }, backButton, nextButton),
  );
  const root = h('div', { class: 'onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboarding-title' }, panel);

  function render(direction) {
    const step = steps[index];
    setText(stepLabel, t('onboarding.step', { current: index + 1, total: steps.length }));
    setText(title, t(step.title));
    setText(subtitle, t(step.subtitle));
    clear(body);
    body.append(step.build());
    progressBar.style.transform = `scaleX(${(index + 1) / steps.length})`;
    backButton.style.visibility = index === 0 ? 'hidden' : 'visible';
    setText(nextButton, index === steps.length - 1 ? t('onboarding.start') : t('common.next'));
    const content = panel.querySelector('.onboarding-step-content');
    content.classList.remove('enter-forward', 'enter-back');
    if (direction && !prefersReducedMotion()) {
      void content.offsetWidth;
      content.classList.add(direction > 0 ? 'enter-forward' : 'enter-back');
    }
    title.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }

  function go(nextIndex) {
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const direction = nextIndex > index ? 1 : -1;
    index = nextIndex;
    render(direction);
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    root.classList.add('is-leaving');
    setTimeout(() => root.remove(), 380);
  }

  function finish() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    store.replace({ ...mergeSettings(store.state, draft), onboarded: true }, 'onboarding');
    close();
    if (onDone) onDone();
  }

  function cancel() {
    close();
    if (onCancel) onCancel();
  }

  function onKey(event) {
    if (event.key === 'Escape' && canCancel) cancel();
  }

  document.addEventListener('keydown', onKey);
  document.body.append(root);
  render(0);
  return { close: cancel };
}
