import { t } from '../../i18n/index.js';
import { dayContext } from '../../core/fasting.js';
import { resetDayPlan } from '../../core/meals.js';
import { createDefaultState, mergeSettings } from '../../core/storage.js';
import { clear, h, icon, pressable } from '../dom.js';
import { confirmDialog, showToast } from '../feedback.js';
import { flexFields, mealsEditor, modeDetails, modePicker, notificationControl, profileFields, toggle } from '../forms.js';

const IGNORED_REASONS = ['settings', 'reminder', 'water', 'meal', 'undo', 'day', 'activity', 'sleep', 'body', 'healthSync'];
const PLAN_REASONS = ['mode', 'fasting'];

function section(title, ...children) {
  return h('section', { class: 'card settings-section' }, h('h2', { class: 'card-title', text: title }), ...children);
}

export function createSettingsView({ store, openOnboarding, sleepActions, bodyActions }) {
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

  function groupToggle(group, checked, onChange) {
    const control = toggle({
      checked,
      label: t(`settings.healthGroups.${group}`),
      hint: t(`settings.healthGroups.${group}Hint`),
      onChange: async (wanted) => {
        const enabled = await onChange(wanted);
        const input = control.querySelector('input');
        if (input) input.checked = enabled;
      },
    });
    return control;
  }

  function healthControls() {
    const groups = store.state.health;
    return [
      h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('settings.healthIntro') })),
      groupToggle('sleep', store.state.sleep.healthEnabled, (wanted) => sleepActions.setHealthEnabled(wanted)),
      groupToggle('body', groups.body, (wanted) => bodyActions.setHealthGroup('body', wanted)),
      groupToggle('activity', groups.activity, (wanted) => bodyActions.setHealthGroup('activity', wanted)),
      groupToggle('nutrition', groups.nutrition, (wanted) => bodyActions.setHealthGroup('nutrition', wanted)),
      groupToggle('heart', groups.heart, (wanted) => bodyActions.setHealthGroup('heart', wanted)),
      (() => {
        const control = toggle({
          checked: groups.writeWeight,
          label: t('settings.writeWeight'),
          hint: t('settings.writeWeightHint'),
          onChange: async (wanted) => {
            const enabled = await bodyActions.setWriteWeight(wanted);
            const input = control.querySelector('input');
            if (input) input.checked = enabled;
          },
        });
        return control;
      })(),
      h(
        'div',
        { class: 'button-row' },
        pressable(
          h(
            'button',
            {
              type: 'button',
              class: 'button button-ghost',
              onClick: async () => {
                const confirmed = await confirmDialog({ title: t('settings.clearBodyTitle'), body: t('settings.clearBodyBody'), confirmLabel: t('settings.clearBodyConfirm'), danger: true });
                if (!confirmed) return;
                bodyActions.clearBodyAndActivity();
                showToast(t('toast.bodyCleared'));
              },
            },
            icon('trash'),
            t('settings.clearBody'),
          ),
        ),
      ),
    ];
  }

  function clearAllHealthButton() {
    return pressable(
      h(
        'button',
        {
          type: 'button',
          class: 'button button-danger',
          onClick: async () => {
            const first = await confirmDialog({ title: t('settings.clearAllHealthTitle'), body: t('settings.clearAllHealthBody'), confirmLabel: t('settings.clearAllHealthNext'), danger: true });
            if (!first) return;
            const second = await confirmDialog({ title: t('settings.clearAllHealthSureTitle'), body: t('settings.clearAllHealthSureBody'), confirmLabel: t('settings.clearAllHealthConfirm'), danger: true });
            if (!second) return;
            bodyActions.clearAllHealthData(createDefaultState(new Date()).profile);
            showToast(t('toast.allHealthCleared'));
            render();
          },
        },
        icon('trash'),
        t('settings.clearAllHealth'),
      ),
    );
  }

  function sleepControls() {
    return [
      h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('settings.sleepDisclosure') })),
      h(
        'div',
        { class: 'button-row' },
        pressable(
          h(
            'button',
            {
              type: 'button',
              class: 'button button-ghost',
              onClick: async () => {
                const confirmed = await confirmDialog({
                  title: t('settings.clearSleepTitle'),
                  body: t('settings.clearSleepBody'),
                  confirmLabel: t('settings.clearSleepConfirm'),
                  danger: true,
                });
                if (!confirmed) return;
                sleepActions.clearSleepData();
                showToast(t('toast.sleepCleared'));
              },
            },
            icon('trash'),
            t('settings.clearSleep'),
          ),
        ),
      ),
    ].filter(Boolean);
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
      ...[
      section(t('settings.modeSection'), modePicker(draft, commit), details.element),
      section(t('settings.mealsSection'), meals.element),
      section(t('settings.flexSection'), flexFields(draft, commit)),
      section(t('settings.hydrationSection'), profileFields(draft, commit)),
      section(t('settings.notificationsSection'), notificationControl(draft, commit)),
      sleepActions && sleepActions.healthAvailable() ? section(t('settings.healthSection'), ...healthControls()) : null,
      sleepActions ? section(t('settings.sleepSection'), ...sleepControls()) : null,
      section(
        t('settings.dataSection'),
        h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('settings.privacy') })),
        h(
          'div',
          { class: 'button-row' },
          pressable(h('button', { type: 'button', class: 'button button-soft', onClick: () => openOnboarding() }, t('settings.redoOnboarding'))),
          bodyActions ? clearAllHealthButton() : null,
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
      ].filter(Boolean),
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
