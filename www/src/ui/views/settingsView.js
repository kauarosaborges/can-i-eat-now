import { t } from '../../i18n/index.js';
import { dayContext } from '../../core/fasting.js';
import { resetDayPlan } from '../../core/meals.js';
import { mergeSettings } from '../../core/storage.js';
import { clear, h, icon, pressable } from '../dom.js';
import { confirmDialog, showToast } from '../feedback.js';
import { flexFields, mealsEditor, modeDetails, modePicker, notificationControl, profileFields } from '../forms.js';

const IGNORED_REASONS = ['settings', 'reminder', 'water', 'meal', 'undo', 'day'];
const PLAN_REASONS = ['mode', 'fasting'];

function section(title, ...children) {
  return h('section', { class: 'card settings-section' }, h('h2', { class: 'card-title', text: title }), ...children);
}

export function createSettingsView({ store, openOnboarding }) {
  const content = h('div', { class: 'settings-grid' });
  const element = h(
    'section',
    { class: 'view view-settings' },
    h('header', { class: 'view-header' }, h('p', { class: 'view-eyebrow', text: t('settings.autosave') }), h('h1', { class: 'view-title', text: t('settings.title') })),
    content,
  );
  let draft = null;
  let details = null;
  let meals = null;
  let pendingRender = false;

  function commit(reason) {
    const current = store.state;
    let next = mergeSettings(current, draft);
    if (PLAN_REASONS.includes(reason)) {
      const context = dayContext(current.fasting, current.days, new Date());
      if (current.days[context.key]) next = { ...next, days: { ...next.days, [context.key]: resetDayPlan(current.days[context.key]) } };
    }
    store.replace(next, 'settings');
    if (reason === 'mode' && details) details.render();
    if (meals && (reason === 'mode' || reason === 'fasting')) meals.refreshWarnings();
  }

  function isEditing() {
    return content.contains(document.activeElement) && document.activeElement !== document.body;
  }

  function render() {
    pendingRender = false;
    draft = store.snapshot();
    clear(content);
    details = modeDetails(draft, commit);
    meals = mealsEditor(draft, commit);
    content.append(
      section(t('settings.modeSection'), modePicker(draft, commit), details.element),
      section(t('settings.mealsSection'), meals.element),
      section(t('settings.flexSection'), flexFields(draft, commit)),
      section(t('settings.hydrationSection'), profileFields(draft, commit)),
      section(t('settings.notificationsSection'), notificationControl(draft, commit)),
      section(
        t('settings.dataSection'),
        h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('settings.privacy') })),
        h(
          'div',
          { class: 'button-row' },
          pressable(h('button', { type: 'button', class: 'button button-soft', onClick: () => openOnboarding() }, t('settings.redoOnboarding'))),
          pressable(
            h(
              'button',
              {
                type: 'button',
                class: 'button button-danger',
                onClick: async () => {
                  const confirmed = await confirmDialog({
                    title: t('settings.resetConfirmTitle'),
                    body: t('settings.resetConfirmBody'),
                    confirmLabel: t('settings.resetConfirm'),
                    danger: true,
                  });
                  if (!confirmed) return;
                  store.reset();
                  showToast(t('toast.reset'));
                },
              },
              icon('trash'),
              t('settings.reset'),
            ),
          ),
        ),
      ),
    );
  }

  content.addEventListener('focusout', (event) => {
    if (!pendingRender) return;
    if (event.relatedTarget && content.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (pendingRender && !isEditing()) render();
    }, 0);
  });

  return {
    element,
    mounted() {
      render();
    },
    tick() {},
    refresh(reason) {
      if (IGNORED_REASONS.includes(reason)) return;
      if (isEditing()) {
        pendingRender = true;
        return;
      }
      render();
    },
    destroy() {},
  };
}
