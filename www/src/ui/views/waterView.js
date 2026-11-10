import { t } from '../../i18n/index.js';
import {
  CUSTOM_WATER_LIMITS,
  QUICK_AMOUNTS_ML,
  computeDailyGoal,
  hydrationDayContext,
  hydrationRatio,
  nextReminderMinute,
  totalWaterMl,
  validateWaterAmount,
} from '../../core/hydration.js';
import { nightMode, waterScheduleFor } from '../../core/sleep.js';
import { tween } from '../animation.js';
import { createWaveVessel } from '../components/waveVessel.js';
import { clear, h, icon, pressable, prefersReducedMotion, setText } from '../dom.js';
import { formatMl, formatTimeOfDay, formatTimestamp } from '../format.js';
import { shouldShowIosHint } from '../notifications.js';

const GLASS_SCALE_ML = 500;

export function createWaterView({ store, actions }) {
  const body = createWaveVessel({ shape: 'body', className: 'body-canvas' });
  const glass = createWaveVessel({ shape: 'glass', className: 'glass-canvas', label: t('water.glassLabel') });
  const percent = h('span', { class: 'water-percent' });
  const progressLine = h('p', { class: 'water-progress' });
  const remainingLine = h('p', { class: 'water-remaining' });
  const reminderLine = h('p', { class: 'reminder-next' });
  const intervalLine = h('p', { class: 'field-hint' });
  const howList = h('ul', { class: 'how-list' });
  const logList = h('ol', { class: 'water-log' });
  const customInput = h('input', {
    class: 'input',
    type: 'number',
    inputmode: 'numeric',
    min: CUSTOM_WATER_LIMITS.min,
    max: CUSTOM_WATER_LIMITS.max,
    step: 10,
    placeholder: t('water.customPlaceholder'),
    'aria-label': t('water.customLabel'),
    'aria-describedby': 'custom-water-error',
  });
  const customError = h('p', { class: 'field-error', id: 'custom-water-error', role: 'alert' });

  function logWater(ml) {
    const amount = actions.addWater(ml);
    glass.setLevel(0, { immediate: true });
    glass.setLevel(Math.min(1, amount / GLASS_SCALE_ML), { slosh: true });
    body.setLevel(currentRatio(), { slosh: true });
  }

  const quickButtons = QUICK_AMOUNTS_ML.map((ml) =>
    pressable(h('button', { type: 'button', class: 'water-chip', onClick: () => logWater(ml) }, icon('water'), h('span', { text: t('water.quickAmount', { amount: formatMl(ml) }) }))),
  );

  const customForm = h(
    'form',
    {
      class: 'custom-water',
      novalidate: true,
      onSubmit: (event) => {
        event.preventDefault();
        const result = validateWaterAmount(customInput.value);
        if (!result.ok) {
          setText(customError, t(`water.customErrors.${result.error}`, CUSTOM_WATER_LIMITS));
          customInput.setAttribute('aria-invalid', 'true');
          customInput.focus();
          return;
        }
        setText(customError, '');
        customInput.removeAttribute('aria-invalid');
        customInput.value = '';
        logWater(result.value);
      },
    },
    customInput,
    pressable(h('button', { type: 'submit', class: 'button button-primary' }, icon('plus'), t('water.customAdd'))),
  );

  const element = h(
    'section',
    { class: 'view view-water' },
    h('header', { class: 'view-header' }, h('p', { class: 'view-eyebrow', text: t('water.goalLabel') }), h('h1', { class: 'view-title', text: t('water.title') })),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'split-main' },
        h('section', { class: 'card body-card' }, h('div', { class: 'body-stage' }, body.element, h('div', { class: 'body-stats' }, percent, progressLine, remainingLine))),
      ),
      h(
        'div',
        { class: 'split-side' },
        h(
          'section',
          { class: 'card' },
          h('div', { class: 'quick-head' }, h('h2', { class: 'card-title', text: t('water.quickAdd') }), glass.element),
          h('div', { class: 'water-chips' }, quickButtons),
          h('p', { class: 'field-label', text: t('water.customLabel') }),
          customForm,
          customError,
          pressable(h('button', { type: 'button', class: 'button button-ghost', onClick: () => { if (actions.undoWater()) body.setLevel(currentRatio(), { slosh: true }); } }, icon('undo'), t('water.undo'))),
        ),
        h('section', { class: 'card' }, h('div', { class: 'reminder-head' }, icon('bell'), reminderLine), intervalLine, shouldShowIosHint() ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('water.iosHint') })) : null),
        h('section', { class: 'card' }, h('h2', { class: 'card-title', text: t('water.todayLog') }), logList),
        h('details', { class: 'card how-card' }, h('summary', { class: 'card-title', text: t('water.howTitle') }), howList),
      ),
    ),
  );

  let shownPercent = 0;
  let cancelTween = null;
  let signature = '';

  function currentRatio() {
    const context = hydrationDayContext(store.state.profile, new Date());
    const total = totalWaterMl(store.dayLog(context.key).water);
    return hydrationRatio(total, computeDailyGoal(store.state.profile).goalMl);
  }

  function animatePercent(value) {
    if (cancelTween) cancelTween();
    if (prefersReducedMotion()) {
      shownPercent = value;
      setText(percent, t('common.percent', { value }));
      return;
    }
    const from = shownPercent;
    cancelTween = tween({
      from,
      to: value,
      duration: 900,
      onUpdate: (current) => {
        shownPercent = current;
        setText(percent, t('common.percent', { value: Math.round(current) }));
      },
    });
  }

  function render(now) {
    const state = store.state;
    const context = hydrationDayContext(state.profile, now);
    const key = context.key;
    const dayLog = store.dayLog(key);
    const goal = computeDailyGoal(state.profile);
    const total = totalWaterMl(dayLog.water);
    const ratio = hydrationRatio(total, goal.goalMl);
    const schedule = waterScheduleFor(state, key);
    const next = nextReminderMinute(schedule.times, context.minute);
    const night = nightMode(state, now).active;
    const nextSignature = JSON.stringify([key, total, goal.goalMl, dayLog.water.length, next, schedule.intervalMinutes, night]);
    if (nextSignature === signature) return;
    const first = signature === '';
    signature = nextSignature;

    const percentValue = Math.round((total / goal.goalMl) * 100);
    body.setLevel(ratio, { immediate: first && prefersReducedMotion() });
    body.setLabel(t('water.bodyLabel', { percent: percentValue }));
    animatePercent(percentValue);
    setText(progressLine, t('water.progress', { current: formatMl(total), goal: formatMl(goal.goalMl) }));
    setText(remainingLine, total >= goal.goalMl ? t('water.done') : t('water.remaining', { amount: formatMl(goal.goalMl - total) }));
    if (night) setText(reminderLine, t('night.waterHint'));
    else setText(reminderLine, next === null ? t('water.noMoreReminders') : t('water.nextReminder', { time: formatTimeOfDay(next) }));
    setText(intervalLine, t('water.every', { minutes: schedule.intervalMinutes, amount: formatMl(schedule.mlPerReminder) }));

    clear(howList);
    const b = goal.breakdown;
    howList.append(h('li', { text: t('water.howBase', { weight: state.profile.weightKg, perKg: b.mlPerKg, amount: formatMl(b.baseMl) }) }));
    if (b.activityBonusMl > 0) howList.append(h('li', { text: t('water.howActivity', { amount: formatMl(b.activityBonusMl) }) }));
    if (b.exerciseMl > 0) howList.append(h('li', { text: t('water.howExercise', { minutes: state.profile.exerciseMinutes, amount: formatMl(b.exerciseMl) }) }));
    if (b.climateMl > 0) howList.append(h('li', { text: t('water.howClimate', { amount: formatMl(b.climateMl) }) }));
    if (b.clamped) howList.append(h('li', { text: t('water.howClamp') }));
    howList.append(h('li', { class: 'how-total', text: t('water.howRound', { amount: formatMl(goal.goalMl) }) }));

    clear(logList);
    if (dayLog.water.length === 0) {
      logList.append(h('li', { class: 'empty-note', text: t('water.empty') }));
    } else {
      for (const entry of [...dayLog.water].reverse()) {
        logList.append(h('li', { class: 'water-log-item', text: t('water.entry', { time: formatTimestamp(entry.at), amount: formatMl(entry.ml) }) }));
      }
    }
  }

  return {
    element,
    mounted() {
      body.mount();
      glass.mount();
      glass.setLevel(0.35, { immediate: true });
      render(new Date());
    },
    tick(now) {
      render(now);
    },
    refresh() {
      signature = '';
      render(new Date());
    },
    destroy() {
      if (cancelTween) cancelTween();
      body.destroy();
      glass.destroy();
    },
  };
}
