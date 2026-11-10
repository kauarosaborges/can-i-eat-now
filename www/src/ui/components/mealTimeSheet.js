import { t } from '../../i18n/index.js';
import { mealMinuteProblem } from '../../core/dayRepair.js';
import { effectiveWindow, isInsideWindow } from '../../core/fasting.js';
import { mealsForDay, placeInWindow, scheduledMinutes } from '../../core/meals.js';
import { isValidTime, minutesToTime, timeToMinutes } from '../../core/time.js';
import { h, pressable, setText } from '../dom.js';
import { openOverlay } from '../feedback.js';

export function openMealTimeSheet({ store, actions, mealId }) {
  const context = actions.mealContext();
  const state = store.state;
  const dayLog = store.dayLog(context.key);
  const entry = mealsForDay(state.meals, context.plan).find((item) => item.id === mealId);
  if (!entry) return;
  const scheduled = scheduledMinutes(entry, dayLog);
  const changed = scheduled !== entry.plannedMinutes;
  const name = actions.mealName(mealId, context.plan);
  const titleId = 'meal-time-title';
  const input = h('input', { class: 'input', type: 'time', value: minutesToTime(scheduled), step: 300, 'aria-label': t('mealTime.label') });
  const message = h('p', { class: 'field-error', role: 'alert' });
  let overlay = null;

  function validate() {
    message.classList.remove('is-warning');
    if (!isValidTime(input.value)) {
      setText(message, t('mealTime.invalid'));
      return null;
    }
    const minute = placeInWindow(timeToMinutes(input.value), context.plan.window);
    const problem = mealMinuteProblem(store.state, context.key, context.plan, minute, { allowOutsideWindow: true });
    if (problem !== null) {
      setText(message, t(problem === 'sleep' ? 'mealTime.duringSleep' : 'mealTime.beforeWake'));
      return null;
    }
    const window = effectiveWindow(context.plan, dayLog);
    if (!isInsideWindow(window, minute)) {
      message.classList.add('is-warning');
      setText(message, t('mealTime.outsideWindow'));
    } else {
      setText(message, '');
    }
    return minute;
  }

  input.addEventListener('change', validate);

  const content = [
    h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('h2', { class: 'dialog-title', id: titleId, text: name }),
    h('p', { class: 'dialog-body', text: changed ? t('mealTime.changedFrom', { time: minutesToTime(entry.plannedMinutes) }) : t('mealTime.planned', { time: minutesToTime(entry.plannedMinutes) }) }),
    h('div', { class: 'sheet-body' }, h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('mealTime.label') }), input), message, h('p', { class: 'field-hint', text: t('mealTime.onlyToday') })),
    h(
      'div',
      { class: 'dialog-actions' },
      changed
        ? pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('mealTime.restore'), onClick: () => { actions.restoreMealTimeToday(mealId); overlay.close(true); } }))
        : null,
      pressable(
        h('button', {
          type: 'button',
          class: 'button button-primary',
          'data-autofocus': true,
          text: t('mealTime.save'),
          onClick: () => {
            const minute = validate();
            if (minute === null) return;
            actions.setMealTimeToday(mealId, minute);
            overlay.close(true);
          },
        }),
      ),
    ),
  ];
  overlay = openOverlay({ className: 'sheet-panel', variant: 'sheet', labelledBy: titleId, content });
}
