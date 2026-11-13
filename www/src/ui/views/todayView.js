import { t } from '../../i18n/index.js';
import { FASTING_STAGES, checkEatAt, currentStage, fastProgress, nextStage } from '../../core/fasting.js';
import { buildTimeline, nextMeal } from '../../core/meals.js';
import { nextWakeAfter, nightMode } from '../../core/sleep.js';
import { buildSummary } from '../../core/summary.js';
import { MS_PER_HOUR, MS_PER_MINUTE, toDateKey } from '../../core/time.js';
import { eatingVerdict } from '../../core/verdict.js';
import { createFastRing } from '../components/fastRing.js';
import { createSleepConfirmCard } from '../components/sleepConfirmCard.js';
import { createSummaryGrid } from '../components/summaryGrid.js';
import { reminderCard } from '../components/measureParts.js';
import { isHealthSyncing, onHealthSyncChange } from '../healthEpoch.js';
import { openEatSheet } from '../components/eatSheet.js';
import { openMealTimeSheet } from '../components/mealTimeSheet.js';
import { confirmDialog } from '../feedback.js';
import { clear, h, icon, pressable, setText } from '../dom.js';
import { formatClock, formatDateHeading, formatDayLong, formatDuration, formatTimeOfDay, formatTimestamp } from '../format.js';

const ACTIONABLE = ['allowedNow', 'upcoming', 'missed'];

function statusText(item, plan) {
  if (item.status === 'done') return t('meal.status.done', { time: formatTimeOfDay(item.eatenMinutes) });
  if (item.status === 'skipped') return item.skipReason === 'noFit' ? t('meal.status.skippedNoFit') : t('meal.status.skipped');
  if (item.status === 'notAllowed') return plan.isFastingDay ? t('meal.status.notAllowedFasting') : t('meal.status.notAllowed');
  if (item.status === 'upcoming') return t('meal.status.upcoming', { time: formatTimeOfDay(item.scheduledMinutes) });
  return t(`meal.status.${item.status}`);
}

export function createTodayView({ store, actions, sleepActions, measureActions }) {
  const measureDue = h('div', { class: 'measure-due-slot' });
  let measureDueSignature = '';
  const dateLabel = h('p', { class: 'view-eyebrow' });
  const verdictWord = h('span', { class: 'verdict-word' });
  const verdict = h('div', { class: 'verdict', 'aria-live': 'polite' }, h('span', { class: 'verdict-glow', 'aria-hidden': 'true' }), h('span', { class: 'verdict-ripple', 'aria-hidden': 'true' }), verdictWord);
  const verdictHint = h('p', { class: 'verdict-hint' });
  const verdictExtra = h('div', { class: 'verdict-extra' });
  const ateNowButton = pressable(h('button', { type: 'button', class: 'button button-soft', onClick: () => openEatSheet({ store, actions, preferSnack: nightMode(store.state, new Date()).active }) }, icon('fork'), t('today.ateNow')));
  const verdictCard = h('section', { class: 'card verdict-card' }, h('p', { class: 'verdict-question', text: t('today.question') }), verdict, verdictHint, verdictExtra, ateNowButton);
  const nightCard = h('section', { class: 'card night-card', hidden: true });
  const sleepConfirm = createSleepConfirmCard({ store, sleepActions });
  const summaryGrid = createSummaryGrid();
  let summarySignature = '';
  const ringTitle = h('h2', { class: 'card-title' });
  const ring = createFastRing();
  const stageList = h('ol', { class: 'stage-list' });
  const stageNote = h('p', { class: 'stage-note' });
  const nextMealLine = h('p', { class: 'next-meal' });
  const timelineList = h('ol', { class: 'timeline' });
  const restoreButton = pressable(
    h('button', {
      type: 'button',
      class: 'button button-small button-ghost restore-day',
      hidden: true,
      text: t('mealTime.restoreDay'),
      onClick: async () => {
        const confirmed = await confirmDialog({ title: t('mealTime.restoreDayTitle'), body: t('mealTime.restoreDayBody'), confirmLabel: t('mealTime.restoreDayConfirm') });
        if (confirmed) actions.restoreTodayPlan();
      },
    }),
  );

  const element = h(
    'section',
    { class: 'view view-today' },
    h('header', { class: 'view-header' }, dateLabel, h('h1', { class: 'view-title brand-title', text: t('app.name') })),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'split-main' },
        nightCard,
        verdictCard,
        sleepConfirm.element,
        h('section', { class: 'card ring-card' }, ringTitle, ring.element, stageNote, stageList, h('p', { class: 'disclaimer', text: t('today.disclaimer') })),
      ),
      h(
        'div',
        { class: 'split-side' },
        h('section', { class: 'card timeline-card' }, h('h2', { class: 'card-title', text: t('today.timelineTitle') }), nextMealLine, timelineList, restoreButton),
      ),
    ),
    measureDue,
    summaryGrid.element,
  );
  const stopSyncWatch = onHealthSyncChange(() => renderSummary(new Date(), true));

  let verdictState = null;
  let timelineSignature = '';
  let extraSignature = '';
  let nightSignature = '';
  let nightDismissedUntil = 0;

  function renderVerdict(result, now, plan) {
    const canEat = result.canEat;
    const fast = result.fast;
    const nextState = canEat ? 'yes' : 'no';
    if (nextState !== verdictState) {
      verdict.classList.remove('is-yes', 'is-no', 'is-changing');
      void verdict.offsetWidth;
      verdict.classList.add(canEat ? 'is-yes' : 'is-no');
      if (verdictState !== null) verdict.classList.add('is-changing');
      setText(verdictWord, canEat ? t('today.yes') : t('today.no'));
      verdictState = nextState;
    }
    const nowMs = now.getTime();
    if (result.reason === 'recentlyAte') {
      const ago = formatDuration(result.minutesSince * MS_PER_MINUTE);
      if (result.availableAt === null) setText(verdictHint, t('today.recentlyAteClosing', { ago }));
      else if (result.nextMealAt !== null && result.nextMealAt > nowMs) setText(verdictHint, t('today.recentlyAte', { ago, time: formatTimestamp(result.nextMealAt) }));
      else setText(verdictHint, t('today.recentlyAteGap', { ago, time: formatTimestamp(result.availableAt) }));
      return;
    }
    if (canEat) {
      const fullDay = plan.window && plan.window.start === 0 && plan.window.end === 1440;
      setText(verdictHint, fullDay ? t('today.yesAllDay') : t('today.yesHint', { time: formatTimestamp(fast.windowEnd), duration: formatDuration(fast.windowEnd - nowMs) }));
    } else if (fast.targetEnd !== null) {
      const sameDay = toDateKey(new Date(fast.targetEnd)) === toDateKey(now);
      setText(
        verdictHint,
        sameDay
          ? t('today.noHint', { duration: formatDuration(fast.targetEnd - nowMs) })
          : t('today.noHintDay', { day: formatDayLong(toDateKey(new Date(fast.targetEnd))), time: formatTimestamp(fast.targetEnd) }),
      );
    } else {
      setText(verdictHint, t('today.noHintUnknown'));
    }
  }

  function renderNight(now) {
    const state = store.state;
    const mode = nightMode(state, now);
    const dismissed = now.getTime() < nightDismissedUntil;
    const showCard = mode.active && !dismissed;
    element.classList.toggle('is-night', mode.active);
    nightCard.hidden = !showCard;
    verdictCard.hidden = showCard;
    const signature = `${showCard}:${mode.awake}`;
    if (signature === nightSignature) return mode;
    nightSignature = signature;
    clear(nightCard);
    if (!showCard) return mode;
    const buttons = [
      pressable(
        h('button', {
          type: 'button',
          class: 'button button-ghost',
          text: t('night.justLooking'),
          onClick: () => {
            nightDismissedUntil = nextWakeAfter(state.profile, now).getTime();
            tick(new Date());
          },
        }),
      ),
    ];
    if (!mode.awake) {
      buttons.push(pressable(h('button', { type: 'button', class: 'button button-soft', text: t('night.cantSleep'), onClick: () => sleepActions.markAwakeAtNight() })));
    }
    nightCard.append(
      h('span', { class: 'night-moon', 'aria-hidden': 'true' }, icon('moon')),
      h('h2', { class: 'night-title', text: t('night.title') }),
      h('p', { class: 'night-body', text: mode.awake ? t('night.awakeBody') : t('night.body') }),
      h('div', { class: 'button-row night-actions' }, buttons),
      pressable(h('button', { type: 'button', class: 'button button-ghost button-small', onClick: () => openEatSheet({ store, actions, preferSnack: true }) }, icon('fork'), t('today.ateNow'))),
    );
    return mode;
  }

  function renderSummary(now, force = false) {
    const key = `${toDateKey(now)}:${now.getHours()}:${now.getMinutes()}`;
    if (!force && key === summarySignature) return;
    summarySignature = key;
    summaryGrid.update(buildSummary(store.state, now), store.state, now, { healthAvailable: sleepActions.healthAvailable(), syncing: isHealthSyncing() });
  }

  function renderExtra(lines) {
    const signature = lines.join('|');
    if (signature === extraSignature) return;
    extraSignature = signature;
    clear(verdictExtra);
    for (const line of lines) verdictExtra.append(h('p', { class: 'verdict-note' }, icon('info'), h('span', { text: line })));
  }

  function renderRing(now, fast) {
    const nowMs = now.getTime();
    if (fast.phase === 'eating') {
      setText(ringTitle, t('today.ringEatingTitle'));
      const total = Math.max(1, fast.windowEnd - fast.windowStart);
      ring.update({
        ratio: (nowMs - fast.windowStart) / total,
        caption: t('today.windowOpenLabel'),
        primary: fast.windowEnd - nowMs > 24 * MS_PER_HOUR ? formatDuration(fast.windowEnd - nowMs) : formatClock(fast.windowEnd - nowMs),
        secondary: fast.lastMealAt !== null && fast.lastMealAt >= fast.windowStart ? t('today.lastMeal', { time: formatTimestamp(fast.lastMealAt) }) : t('today.windowLeft', { duration: formatDuration(fast.windowEnd - nowMs) }),
        tone: 'eating',
      });
      renderStages(null, null);
      setText(stageNote, '');
      return;
    }
    setText(ringTitle, t('today.ringTitle'));
    if (fast.startedAt === null) {
      ring.update({ ratio: 0, caption: t('today.fastedLabel'), primary: formatClock(0), secondary: t('today.noFastData'), tone: 'fasting' });
      renderStages(null, null);
      setText(stageNote, '');
      return;
    }
    const progress = fastProgress(fast, now);
    const hours = progress.elapsedMs / MS_PER_HOUR;
    const targetHours = progress.targetMs / MS_PER_HOUR;
    const milestones = FASTING_STAGES.filter((stage) => stage.hours < targetHours).map((stage) => ({
      ratio: stage.hours / targetHours,
      label: t('stages.hours', { hours: stage.hours }),
      reached: hours >= stage.hours,
    }));
    ring.update({
      ratio: progress.ratio,
      caption: t('today.fastedLabel'),
      primary: progress.elapsedMs > 24 * MS_PER_HOUR ? formatDuration(progress.elapsedMs) : formatClock(progress.elapsedMs),
      secondary: fast.targetEnd !== null && progress.remainingMs > 0 ? t('today.leftLabel', { duration: formatDuration(progress.remainingMs) }) : t('today.goalReached'),
      milestones,
      tone: 'fasting',
    });
    const stage = currentStage(hours);
    const upcoming = nextStage(hours);
    renderStages(stage, hours);
    const parts = [];
    if (stage) parts.push(t('today.stageNow', { stage: t(`stages.${stage.key}`) }));
    if (upcoming) parts.push(t('today.stageNext', { stage: t(`stages.${upcoming.key}`), duration: formatDuration((upcoming.hours - hours) * MS_PER_HOUR) }));
    setText(stageNote, parts.join(t('common.separator')));
  }

  let stageSignature = '';
  function renderStages(stage, hours) {
    const signature = hours === null ? 'none' : FASTING_STAGES.map((item) => (hours >= item.hours ? 1 : 0)).join('');
    if (signature === stageSignature) return;
    stageSignature = signature;
    clear(stageList);
    if (hours === null) return;
    for (const item of FASTING_STAGES) {
      const reached = hours >= item.hours;
      stageList.append(
        h(
          'li',
          { class: ['stage-chip', reached ? 'is-reached' : null, stage && stage.key === item.key ? 'is-current' : null] },
          h('span', { class: 'stage-hours', text: t('stages.hours', { hours: item.hours }) }),
          h('span', { class: 'stage-name', text: t(`stages.${item.key}`) }),
        ),
      );
    }
  }

  function mealRow(item, plan) {
    const name = item.isModified ? actions.mealName(item.id, plan) : item.name;
    const buttons = [];
    if (ACTIONABLE.includes(item.status) && item.canEatNow) {
      buttons.push(
        pressable(
          h(
            'button',
            { type: 'button', class: ['button', 'button-small', item.status === 'allowedNow' ? 'button-primary' : 'button-soft'], onClick: () => openEatSheet({ store, actions, mealId: item.id }) },
            icon('fork'),
            t('meal.eatNow'),
          ),
        ),
      );
    }
    if (ACTIONABLE.includes(item.status)) {
      buttons.push(pressable(h('button', { type: 'button', class: 'button button-small button-ghost', onClick: () => actions.skipMeal(item.id) }, t('meal.skip'))));
    }
    return h(
      'li',
      { class: ['meal-row', `status-${item.status}`] },
      h(
        'div',
        { class: 'meal-time' },
        h('span', { class: 'meal-clock', text: formatTimeOfDay(item.status === 'done' ? item.eatenMinutes : item.scheduledMinutes) }),
        item.adjusted && item.status !== 'done' ? h('span', { class: 'meal-planned', text: t('meal.plannedAt', { time: formatTimeOfDay(item.plannedMinutes) }) }) : null,
      ),
      h('span', { class: 'meal-node', 'aria-hidden': 'true' }, item.status === 'done' ? icon('check') : null),
      h(
        'div',
        { class: 'meal-body' },
        item.status === 'done' || item.status === 'notAllowed' && plan.isFastingDay
          ? h('p', { class: 'meal-name', text: name })
          : pressable(h('button', { type: 'button', class: 'meal-name meal-name-button', 'aria-label': t('mealTime.open', { name }), onClick: () => openMealTimeSheet({ store, actions, mealId: item.id }) }, name, icon('clock'))),
        h('span', { class: 'pill', text: statusText(item, plan) }),
        buttons.length ? h('div', { class: 'meal-actions' }, buttons) : null,
      ),
    );
  }

  function snackRow(snack) {
    return h(
      'li',
      { class: 'meal-row status-snack' },
      h('div', { class: 'meal-time' }, h('span', { class: 'meal-clock', text: formatTimeOfDay(snack.minute) })),
      h('span', { class: 'meal-node', 'aria-hidden': 'true' }, icon('flame')),
      h('div', { class: 'meal-body' }, h('p', { class: 'meal-name', text: t('today.snackLabel') }), h('span', { class: 'pill', text: t('today.snackStatus', { time: formatTimeOfDay(snack.minute) }) })),
    );
  }

  function renderTimeline(plan, dayLog, minute) {
    const timeline = buildTimeline(store.state.meals, plan, dayLog, minute, store.state.fasting.toleranceMinutes);
    const upcoming = nextMeal(timeline);
    if (!upcoming) {
      setText(nextMealLine, t('today.noMoreMeals'));
    } else {
      const name = upcoming.isModified ? actions.mealName(upcoming.id, plan) : upcoming.name;
      const wait = (upcoming.scheduledMinutes - minute) * MS_PER_MINUTE;
      setText(nextMealLine, wait <= 0 ? t('today.nextMealNow', { name }) : t('today.nextMeal', { name, time: formatTimeOfDay(upcoming.scheduledMinutes), duration: formatDuration(wait) }));
    }
    restoreButton.hidden = !(dayLog.windowShift !== 0 || Object.keys(dayLog.adjustments).length > 0 || Object.keys(dayLog.manualTimes || {}).length > 0);
    const snacks = dayLog.snacks || [];
    const signature = JSON.stringify([timeline.map((item) => [item.id, item.name, item.status, item.scheduledMinutes, item.canEatNow, item.eatenMinutes]), snacks.map((snack) => snack.id)]);
    if (signature === timelineSignature) return;
    timelineSignature = signature;
    clear(timelineList);
    const rows = [
      ...timeline.map((item) => ({ minute: item.status === 'done' ? item.eatenMinutes : item.scheduledMinutes, node: mealRow(item, plan) })),
      ...snacks.map((snack) => ({ minute: snack.minute, node: snackRow(snack) })),
    ].sort((left, right) => left.minute - right.minute);
    for (const row of rows) timelineList.append(row.node);
  }

  function tick(now) {
    const state = store.state;
    const result = eatingVerdict(state, now);
    const context = result.context;
    const plan = context.plan;
    const dayLog = store.dayLog(context.key);
    setText(dateLabel, formatDateHeading(now));
    const mode = renderNight(now);
    sleepConfirm.update(now, mode.active);
    renderVerdict(result, now, plan);
    const extra = [];
    if (plan.fastingType === 'zero') extra.push(t('today.fastingDayZero'));
    if (plan.fastingType === 'modified') extra.push(t('today.fastingDayModified', { kcal: plan.modifiedMeal.kcal, time: formatTimeOfDay(plan.modifiedMeal.minutes) }));
    if (dayLog.windowShift < 0) extra.push(t('today.shiftedNote', { minutes: -dayLog.windowShift }));
    if (result.reason === 'fasting' && !mode.active) {
      const check = checkEatAt(plan, dayLog, context.minute, state.fasting.toleranceMinutes);
      if (check.allowed && check.kind === 'advance') extra.push(t('today.canAdvance', { minutes: check.advanceMinutes }));
    }
    renderExtra(extra);
    renderRing(now, result.fast);
    renderTimeline(plan, dayLog, context.minute);
    renderSummary(now);
    renderMeasureDue(now);
  }

  function renderMeasureDue(now) {
    const measurements = store.state.measurements;
    const signature = `${Math.floor(now.getTime() / 60000)}:${measurements.sessions.length}:${JSON.stringify(measurements.reminder)}`;
    if (signature === measureDueSignature || !measureActions) return;
    measureDueSignature = signature;
    clear(measureDue);
    const card = reminderCard({ store, measureActions, now });
    if (card) measureDue.append(card);
  }

  return {
    element,
    tick,
    refresh() {
      timelineSignature = '';
      summarySignature = '';
      measureDueSignature = '';
      nightSignature = '';
      sleepConfirm.reset();
      tick(new Date());
    },
    destroy() {
      stopSyncWatch();
    },
  };
}
