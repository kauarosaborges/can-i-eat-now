import { t } from '../../i18n/index.js';
import { targetFastingHours } from '../../core/fasting.js';
import { buildHistory } from '../../core/history.js';
import { computeDailyGoal } from '../../core/hydration.js';
import { toDateKey, weekdayOfKey } from '../../core/time.js';
import { createBarChart } from '../components/barChart.js';
import { clear, h, icon } from '../dom.js';
import { formatDayShort, formatHours, formatMl } from '../format.js';

function streakText(count) {
  if (count === 0) return t('history.streakZero');
  if (count === 1) return t('history.streakOne');
  return t('history.streak', { count });
}

export function createHistoryView({ store }) {
  const content = h('div', { class: 'history-content' });
  const element = h(
    'section',
    { class: 'view view-history' },
    h('header', { class: 'view-header' }, h('p', { class: 'view-eyebrow', text: t('history.subtitle') }), h('h1', { class: 'view-title', text: t('history.title') })),
    content,
  );
  let renderedKey = '';

  function render() {
    const now = new Date();
    const state = store.state;
    const history = buildHistory(state, now);
    const target = targetFastingHours(state.fasting);
    const goalMl = computeDailyGoal(state.profile).goalMl;
    renderedKey = toDateKey(now);
    clear(content);

    const fastingChart = createBarChart({
      entries: history.entries,
      maxValue: 24,
      gridValues: [8, 16, 24],
      targetValue: target,
      targetLabel: target ? t('history.target', { hours: target }) : '',
      ariaLabel: t('history.chartLabel'),
      valueOf: (entry) => entry.hours,
      toneOf: (entry) => (entry.hours === null ? 'empty' : entry.onTrack ? 'good' : 'off'),
      labelOf: (entry) => t(`days.initial.${weekdayOfKey(entry.key)}`),
      titleOf: (entry) => (entry.hours === null ? t('history.barNoData', { day: formatDayShort(entry.key) }) : t('history.bar', { day: formatDayShort(entry.key), hours: formatHours(entry.hours) })),
    });

    const waterChart = createBarChart({
      entries: history.entries,
      maxValue: Math.max(goalMl, ...history.entries.map((entry) => entry.waterMl)),
      gridValues: [],
      targetValue: goalMl,
      targetLabel: formatMl(goalMl),
      ariaLabel: t('history.waterTitle'),
      valueOf: (entry) => (entry.waterMl > 0 ? entry.waterMl : null),
      toneOf: (entry) => (entry.waterMl >= goalMl ? 'water' : entry.waterMl > 0 ? 'water-soft' : 'empty'),
      labelOf: (entry) => t(`days.initial.${weekdayOfKey(entry.key)}`),
      titleOf: (entry) => t('history.waterValue', { day: formatDayShort(entry.key), amount: formatMl(entry.waterMl) }),
    });

    content.append(
      h(
        'div',
        { class: 'stat-row' },
        h(
          'section',
          { class: 'card stat-card streak-card' },
          h('span', { class: 'stat-icon' }, icon('flame')),
          h('span', { class: 'stat-value', text: String(history.streak) }),
          h('span', { class: 'stat-label', text: streakText(history.streak) }),
        ),
        h(
          'section',
          { class: 'card stat-card' },
          h('span', { class: 'stat-icon stat-icon-teal' }, icon('today')),
          h('span', { class: 'stat-value', text: history.averageHours === null ? formatHours(0) : formatHours(history.averageHours) }),
          h('span', { class: 'stat-label', text: history.averageHours === null ? t('history.noAverage') : t('history.average', { hours: formatHours(history.averageHours) }) }),
        ),
      ),
      h(
        'section',
        { class: 'card chart-card' },
        h('h2', { class: 'card-title', text: t('history.subtitle') }),
        fastingChart.element,
        h(
          'ul',
          { class: 'legend' },
          h('li', { class: 'legend-item tone-good', text: t('history.legendOnTrack') }),
          h('li', { class: 'legend-item tone-off', text: t('history.legendOff') }),
          h('li', { class: 'legend-item tone-empty', text: t('history.legendNoData') }),
        ),
      ),
      h('section', { class: 'card chart-card' }, h('h2', { class: 'card-title', text: t('history.waterTitle') }), waterChart.element),
    );
  }

  return {
    element,
    mounted() {
      render();
    },
    tick(now) {
      if (toDateKey(now) !== renderedKey) render();
    },
    refresh() {
      render();
    },
    destroy() {},
  };
}
