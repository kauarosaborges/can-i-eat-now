import { t } from '../../i18n/index.js';
import {
  FASTING_STAGES,
  checkEatAt,
  dayContext,
  currentStage,
  fastProgress,
  fastState,
  nextStage,
} from '../../core/fasting.js';
import { buildTimeline, nextMeal } from '../../core/meals.js';
import { MS_PER_HOUR, MS_PER_MINUTE, toDateKey } from '../../core/time.js';
import { createFastRing } from '../components/fastRing.js';
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

export function createTodayView({ store, actions }) {
  const dateLabel = h('p', { class: 'view-eyebrow' });
  const verdictWord = h('span', { class: 'verdict-word' });
  const verdictIcon = h('span', { class: 'verdict-icon' });
  const verdict = h('div', { class: 'verdict', 'aria-live': 'polite' }, h('span', { class: 'verdict-glow', 'aria-hidden': 'true' }), h('span', { class: 'verdict-ripple', 'aria-hidden': 'true' }), verdictIcon, verdictWord);
  const verdictHint = h('p', { class: 'verdict-hint' });
  const verdictExtra = h('div', { class: 'verdict-extra' });
  const ringTitle = h('h2', { class: 'card-title' });
  const ring = createFastRing();
  const stageList = h('ol', { class: 'stage-list' });
  const stageNote = h('p', { class: 'stage-note' });
  const nextMealLine = h('p', { class: 'next-meal' });
  const timelineList = h('ol', { class: 'timeline' });

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
        h('section', { class: 'card verdict-card' }, h('p', { class: 'verdict-question', text: t('today.question') }), verdict, verdictHint, verdictExtra),
        h('section', { class: 'card ring-card' }, ringTitle, ring.element, stageNote, stageList, h('p', { class: 'disclaimer', text: t('today.disclaimer') })),
      ),
      h(
        'div',
        { class: 'split-side' },
        h('section', { class: 'card timeline-card' }, h('h2', { class: 'card-title', text: t('today.timelineTitle') }), nextMealLine, timelineList),
      ),
    ),
  );

  let verdictState = null;
  let timelineSignature = '';
  let extraSignature = '';

  function renderVerdict(canEat, now, fast, plan) {
    const nextState = canEat ? 'yes' : 'no';
    if (nextState !== verdictState) {
      verdict.classList.remove('is-yes', 'is-no', 'is-changing');
      void verdict.offsetWidth;
      verdict.classList.add(canEat ? 'is-yes' : 'is-no');
      if (verdictState !== null) verdict.classList.add('is-changing');
      clear(verdictIcon);
      verdictIcon.append(icon(canEat ? 'check' : 'close'));
      setText(verdictWord, canEat ? t('today.yes') : t('today.no'));
      verdictState = nextState;
    }
    const nowMs = now.getTime();
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
    const signature = JSON.stringify(timeline.map((item) => [item.id, item.name, item.status, item.scheduledMinutes, item.canEatNow, item.eatenMinutes]));
    if (signature === timelineSignature) return;
    timelineSignature = signature;
    clear(timelineList);
    for (const item of timeline) {
      const name = item.isModified ? actions.mealName(item.id, plan) : item.name;
      const buttons = [];
      if (ACTIONABLE.includes(item.status) && item.canEatNow) {
        buttons.push(
          pressable(
            h(
              'button',
              { type: 'button', class: ['button', 'button-small', item.status === 'allowedNow' ? 'button-primary' : 'button-soft'], onClick: () => actions.eatMeal(item.id) },
              icon('fork'),
              t('meal.eatNow'),
            ),
          ),
        );
      }
      if (ACTIONABLE.includes(item.status)) {
        buttons.push(pressable(h('button', { type: 'button', class: 'button button-small button-ghost', onClick: () => actions.skipMeal(item.id) }, t('meal.skip'))));
      }
      timelineList.append(
        h(
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
            h('p', { class: 'meal-name', text: name }),
            h('span', { class: 'pill', text: statusText(item, plan) }),
            buttons.length ? h('div', { class: 'meal-actions' }, buttons) : null,
          ),
        ),
      );
    }
  }

  function tick(now) {
    const state = store.state;
    const context = dayContext(state.fasting, state.days, now);
    const plan = context.plan;
    const dayLog = store.dayLog(context.key);
    const fast = fastState(state, now);
    const canEat = fast.phase === 'eating';
    setText(dateLabel, formatDateHeading(now));
    renderVerdict(canEat, now, fast, plan);
    const extra = [];
    if (plan.fastingType === 'zero') extra.push(t('today.fastingDayZero'));
    if (plan.fastingType === 'modified') extra.push(t('today.fastingDayModified', { kcal: plan.modifiedMeal.kcal, time: formatTimeOfDay(plan.modifiedMeal.minutes) }));
    if (dayLog.windowShift < 0) extra.push(t('today.shiftedNote', { minutes: -dayLog.windowShift }));
    if (!canEat) {
      const check = checkEatAt(plan, dayLog, context.minute, state.fasting.toleranceMinutes);
      if (check.allowed && check.kind === 'advance') extra.push(t('today.canAdvance', { minutes: check.advanceMinutes }));
    }
    renderExtra(extra);
    renderRing(now, fast);
    renderTimeline(plan, dayLog, context.minute);
  }

  return {
    element,
    tick,
    refresh() {
      timelineSignature = '';
      tick(new Date());
    },
    destroy() {},
  };
}
