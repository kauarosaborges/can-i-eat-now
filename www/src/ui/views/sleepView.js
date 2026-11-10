import { t } from '../../i18n/index.js';
import { nightMode, shouldOfferSleepConfirm } from '../../core/sleep.js';
import { lastNightKey, nightTone, scoreNight, sleepOverview, sleepSeries } from '../../core/sleepQuality.js';
import { toDateKey, weekdayOfKey } from '../../core/time.js';
import { createBarChart } from '../components/barChart.js';
import { createStageBar } from '../components/charts.js';
import { createSleepConfirmCard } from '../components/sleepConfirmCard.js';
import { openSleepEntrySheet } from '../components/sleepEntrySheet.js';
import { clear, h, icon, pressable, svg } from '../dom.js';
import { segmented } from '../forms.js';
import { formatDateShort, formatDayShort, formatGoal, formatMinutes, formatTimeOfDay, formatTimestamp } from '../format.js';

const STAGES = ['deep', 'rem', 'core', 'awake'];
const RECENT_NIGHTS = 7;
const SOURCE_TEXT = { health: 'sleep.fromHealth', confirmed: 'sleep.fromUser', inferred: 'sleep.fromInferred' };

function factorText(result) {
  if (!result.weakest) return t('sleep.factor.none');
  if (result.weakest === 'duration' && result.oversleep) return t('sleep.factor.oversleep');
  return t(`sleep.factor.${result.weakest}`, { goal: formatGoal(result.goal) });
}

function hasStages(detail) {
  return Boolean(detail && detail.deep + detail.rem + detail.core > 0);
}

function awakeningsText(count) {
  return count === 1 ? t('sleep.awakeningsOne') : t('sleep.awakeningsMany', { count });
}

function scoreRing(result, label) {
  const ring = svg(
    'svg',
    { class: 'sleep-ring-svg', viewBox: '0 0 120 120', 'aria-hidden': 'true' },
    svg('circle', { class: 'sleep-ring-track', cx: 60, cy: 60, r: 50 }),
    svg('circle', { class: 'sleep-ring-progress', cx: 60, cy: 60, r: 50, pathLength: 100, transform: 'rotate(-90 60 60)', style: { '--ring-offset': String(100 - result.score) } }),
  );
  const number = h('span', { class: 'sleep-ring-number', 'data-score': String(result.score), style: { '--score': String(result.score) } });
  return h(
    'div',
    { class: 'sleep-score', role: 'img', 'aria-label': t('sleep.scoreAria', { score: result.score, label }) },
    h('div', { class: 'sleep-ring' }, ring, h('div', { class: 'sleep-ring-center' }, number, h('span', { class: 'sleep-ring-out', text: t('sleep.outOf') }))),
    h('div', { class: 'sleep-score-meta' }, h('span', { class: ['pill', 'sleep-label', `is-${result.label}`], text: label }), h('p', { class: 'sleep-factor', text: factorText(result) })),
  );
}

export function createSleepView({ store, sleepActions }) {
  const confirm = createSleepConfirmCard({ store, sleepActions });
  const eyebrow = h('p', { class: 'view-eyebrow' });
  const content = h('div', { class: 'sleep-content' });
  const element = h('section', { class: 'view view-sleep' }, h('header', { class: 'view-header' }, eyebrow, h('h1', { class: 'view-title', text: t('sleep.title') })), confirm.element, content);
  let range = 7;
  let renderedKey = '';

  function viewKey(now) {
    return `${toDateKey(now)}:${lastNightKey(store.state, now)}`;
  }

  function openNight(key, entry) {
    const editable = entry && entry.source !== 'health';
    openSleepEntrySheet({
      store,
      sleepActions,
      wakeKey: key,
      initial: entry && entry.kind !== 'awake' ? entry : null,
      onDelete: editable ? () => sleepActions.deleteNight(key) : null,
    });
  }

  function lastNightCard(state, now) {
    const key = lastNightKey(state, now);
    eyebrow.textContent = t('sleep.eyebrow', { date: formatDateShort(key) });
    const result = scoreNight(state, key);
    if (!result && key === toDateKey(now) && !nightMode(state, now).active && shouldOfferSleepConfirm(state, now)) return null;
    if (!result) {
      return h(
        'section',
        { class: 'card sleep-night-card is-empty' },
        h('h2', { class: 'card-title', text: t('sleep.emptyTitle') }),
        h('p', { class: 'field-hint', text: t('sleep.emptyBody') }),
        h(
          'div',
          { class: 'button-row' },
          pressable(h('button', { type: 'button', class: 'button button-small button-soft', onClick: () => openNight(key, null) }, icon('plus'), t('sleep.register'))),
          pressable(h('button', { type: 'button', class: 'button button-small button-ghost', text: t('sleep.noSleep'), onClick: () => sleepActions.markNoSleep(key) })),
        ),
      );
    }
    const entry = result.entry;
    const locked = entry.source === 'health';
    const footer = h(
      'div',
      { class: 'sleep-footer' },
      h('p', { class: 'sleep-source', text: t(SOURCE_TEXT[entry.source] || 'sleep.fromUser') }),
      locked ? null : pressable(h('button', { type: 'button', class: 'button button-small button-soft', onClick: () => openNight(key, entry) }, icon('pencil'), t('sleep.edit'))),
    );
    if (result.awake) {
      return h('section', { class: 'card sleep-night-card' }, h('p', { class: 'sleep-awake-note' }, icon('moon'), h('span', { text: t('sleep.awakeNight') })), footer);
    }
    const label = t(`sleep.labels.${result.label}`);
    const detail = entry.detail || null;
    const facts = [t('sleep.facts', { bed: formatTimestamp(entry.sleptAt), wake: formatTimestamp(entry.wokeAt) }), formatMinutes(result.minutes)];
    if (detail && detail.awakeKnown) facts.push(awakeningsText(detail.awakenings));
    let stagesBlock = null;
    if (hasStages(detail)) {
      const segments = STAGES.map((stage) => ({ className: `stage-${stage}`, value: detail[stage], title: t('sleep.stageValue', { stage: t(`sleep.stages.${stage}`), duration: formatMinutes(detail[stage]) }) }));
      stagesBlock = h(
        'div',
        { class: 'sleep-stages' },
        createStageBar({ segments, ariaLabel: t('sleep.stagesAria', { list: segments.map((segment) => segment.title).join(', ') }) }).element,
        h('ul', { class: 'legend' }, segments.map((segment, index) => h('li', { class: ['legend-item', `legend-stage-${STAGES[index]}`], text: segment.title }))),
      );
    }
    return h('section', { class: 'card sleep-night-card' }, scoreRing(result, label), h('p', { class: 'sleep-facts', text: facts.join(t('common.dot')) }), stagesBlock, footer);
  }

  function chartBody(state, now) {
    const series = sleepSeries(state, now, range);
    const overview = sleepOverview(state, now, range);
    const goalHours = overview.goal / 60;
    const maxHours = Math.max(12, goalHours * 1.25, ...series.map((item) => (item.minutes || 0) / 60));
    const chart = createBarChart({
      entries: series,
      maxValue: maxHours,
      gridValues: [4, 8, 12].filter((value) => value <= maxHours),
      axisFormat: (value) => t('sleep.hoursAxis', { h: value }),
      targetValue: goalHours,
      targetLabel: t('sleep.goalLine', { goal: formatGoal(overview.goal) }),
      ariaLabel: t('sleep.chartAria', { goal: formatGoal(overview.goal) }),
      valueOf: (item) => (item.entry && !item.awake ? item.minutes / 60 : null),
      toneOf: nightTone,
      labelOf: (item) => (range <= 7 ? t(`days.short.${weekdayOfKey(item.key)}`) : item.isToday || Number(item.key.slice(8, 10)) % 5 === 0 ? String(Number(item.key.slice(8, 10))) : ''),
      titleOf: (item) => {
        const day = formatDayShort(item.key);
        if (!item.entry) return t('sleep.barEmpty', { day });
        if (item.awake) return t('sleep.barAwake', { day });
        return t('sleep.bar', { day, duration: formatMinutes(item.minutes) });
      },
    });
    return [
      chart.element,
      h(
        'ul',
        { class: 'legend' },
        h('li', { class: 'legend-item tone-sleep', text: t('sleep.legendOnGoal') }),
        h('li', { class: 'legend-item tone-sleep-soft', text: t('sleep.legendBelow') }),
        h('li', { class: 'legend-item tone-off', text: t('sleep.legendFarBelow') }),
      ),
      h('p', { class: 'field-note', text: t('sleep.onGoal', { count: overview.onGoal, total: range }) }),
    ];
  }

  function chartCard(state, now) {
    const body = h('div', null, chartBody(state, now));
    const control = segmented({
      label: t('sleep.rangeLabel'),
      value: range,
      options: [
        { value: 7, label: t('sleep.range7') },
        { value: 30, label: t('sleep.range30') },
      ],
      onChange: (value) => {
        range = value;
        clear(body);
        body.append(...chartBody(store.state, new Date()));
      },
    });
    return h('section', { class: 'card chart-card sleep-chart-card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: t('sleep.chartTitle') }), control), body);
  }

  function row(label, value) {
    return h('div', { class: 'sleep-list-row' }, h('dt', { text: label }), h('dd', { text: value }));
  }

  function averagesCard(state, now) {
    const overview = sleepOverview(state, now, 7);
    const regularity = overview.regularity;
    const none = t('sleep.noAverage');
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: t('sleep.averagesTitle') }),
      h(
        'dl',
        { class: 'sleep-list' },
        row(t('sleep.avgBedtime'), overview.averageBedMinute === null ? none : formatTimeOfDay(overview.averageBedMinute)),
        row(t('sleep.avgWake'), overview.averageWakeMinute === null ? none : formatTimeOfDay(overview.averageWakeMinute)),
        row(t('sleep.avgDuration'), overview.averageMinutes === null ? none : formatMinutes(overview.averageMinutes)),
        row(t('sleep.regularity'), regularity ? t('sleep.regularityValue', { minutes: regularity.spread }) : t('sleep.regularityUnknown')),
      ),
    );
  }

  function recentCard(state, now) {
    const series = sleepSeries(state, now, RECENT_NIGHTS).reverse();
    const rows = series.map((item) => {
      const result = item.entry ? scoreNight(state, item.key) : null;
      let value = t('sleep.rowEmpty');
      if (item.awake) value = t('sleep.rowAwake');
      else if (item.entry) value = formatMinutes(item.minutes);
      const day = formatDayShort(item.key);
      const locked = item.entry && item.entry.source === 'health';
      const children = [
        h('span', { class: 'sleep-row-day', text: day }),
        h('span', { class: 'sleep-row-value', text: value }),
        result && result.score !== null ? h('span', { class: ['pill', 'sleep-label', `is-${result.label}`], text: String(result.score) }) : null,
        locked ? h('span', { class: 'sleep-row-tag', text: t('sleep.source.health') }) : h('span', { class: 'sleep-row-chevron', 'aria-hidden': 'true' }, icon(item.entry ? 'pencil' : 'plus')),
      ];
      if (locked) return h('li', { class: 'sleep-row' }, h('div', { class: 'sleep-row-inner' }, children));
      return h(
        'li',
        { class: ['sleep-row', item.entry ? null : 'is-empty'] },
        pressable(
          h(
            'button',
            { type: 'button', class: 'sleep-row-inner sleep-row-button', 'aria-label': item.entry ? t('sleep.rowOpen', { day, value }) : t('sleep.rowRegister', { day }), onClick: () => openNight(item.key, item.entry) },
            children,
          ),
        ),
      );
    });
    return h('section', { class: 'card' }, h('h2', { class: 'card-title', text: t('sleep.recentTitle') }), h('ol', { class: 'sleep-rows' }, rows));
  }

  function render() {
    const now = new Date();
    const state = store.state;
    renderedKey = viewKey(now);
    clear(content);
    const hint = sleepActions.healthAvailable() && !state.sleep.healthEnabled ? h('a', { class: 'hint-card sleep-hint', href: '#/settings' }, icon('info'), h('span', { text: t('sleep.enableHint') })) : null;
    content.append(...[lastNightCard(state, now), chartCard(state, now), averagesCard(state, now), recentCard(state, now), hint].filter(Boolean));
  }

  return {
    element,
    mounted() {
      render();
      sleepActions.syncHealth();
    },
    tick(now) {
      confirm.update(now, nightMode(store.state, now).active);
      if (viewKey(now) !== renderedKey) render();
    },
    refresh(reason) {
      if (reason === 'activity' || reason === 'reminder') return;
      confirm.reset();
      render();
      confirm.update(new Date(), nightMode(store.state, new Date()).active);
    },
    destroy() {},
  };
}
