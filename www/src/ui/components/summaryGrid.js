import { t } from '../../i18n/index.js';
import { targetFastingHours } from '../../core/fasting.js';
import { toDateKey } from '../../core/time.js';
import { clear, h, icon, pressable } from '../dom.js';
import { formatDayShort, formatHours, formatKm, formatMinutes, formatMl, formatNumber, formatPercent, formatRelativeDay } from '../format.js';
import { createBarChart } from './barChart.js';
import { createSparkline } from './charts.js';

export const VISIBLE_CARDS = 6;
const METRIC_GROUPS = { steps: 'activity', active: 'activity', exercise: 'activity', distance: 'activity', restingHr: 'heart', hrv: 'heart' };

function card({ tone, iconName, title, value, unit, subtitle, chart, href, textValue = false }) {
  return h(
    'a',
    { class: ['card', 'summary-card', `summary-${tone}`], href },
    h('span', { class: 'summary-head' }, h('span', { class: 'summary-icon', 'aria-hidden': 'true' }, icon(iconName)), h('span', { class: 'summary-title', text: title }), h('span', { class: 'summary-chevron', 'aria-hidden': 'true' }, icon('chevronRight'))),
    h('span', { class: 'summary-value' }, h('span', { class: ['summary-number', textValue ? 'is-text' : null], text: value }), unit ? h('span', { class: 'summary-unit', text: unit }) : null),
    subtitle ? h('span', { class: 'summary-sub', text: subtitle }) : null,
    chart ? h('div', { class: 'summary-chart' }, chart) : null,
  );
}

function subtitleFor(metric, todayKey, format, extra) {
  const parts = [formatRelativeDay(metric.latest.key, todayKey)];
  if (extra) parts.push(extra);
  else if (metric.average !== null) parts.push(t('summary.average', { value: format(metric.average) }));
  return parts.join(t('common.dot'));
}

function sleepDescriptor(summary) {
  const sleep = summary.sleep;
  const night = sleep.night;
  const values = sleep.series.map((item) => (item.entry && !item.awake ? item.minutes : null));
  return {
    id: 'sleep',
    sig: [night && night.score, night && night.minutes, night && night.awake, values],
    build: () => {
      const title = t('summary.sleepTitle');
      const finite = values.filter((value) => value !== null);
      const chart = finite.length
        ? createBarChart({
            entries: sleep.series,
            mini: true,
            maxValue: Math.max(...finite, night ? night.goal : 0, 1) * 1.08,
            targetValue: night ? night.goal : undefined,
            ariaLabel: t('summary.chartLabel', { title }),
            valueOf: (item) => (item.entry && !item.awake ? item.minutes : null),
            toneOf: (item) => (item.entry && !item.awake ? (item.isToday ? 'card' : 'card-soft') : 'empty'),
          }).element
        : null;
      if (!night) return card({ tone: 'sleep', iconName: 'moon', title, value: t('summary.sleepEmpty'), textValue: true, subtitle: t('summary.sleepEmptyHint'), chart, href: '#/sleep' });
      if (night.awake) return card({ tone: 'sleep', iconName: 'moon', title, value: t('summary.sleepAwake'), textValue: true, chart, href: '#/sleep' });
      return card({ tone: 'sleep', iconName: 'moon', title, value: formatMinutes(night.minutes), subtitle: [t(`sleep.labels.${night.label}`), t('summary.sleepScore', { score: night.score })].join(t('common.dot')), chart, href: '#/sleep' });
    },
  };
}

function waterDescriptor(summary) {
  const water = summary.water;
  return {
    id: 'water',
    sig: [water.ml, water.goalMl],
    build: () => {
      const ratio = Math.max(0, Math.min(1, water.ratio));
      const meter = h(
        'div',
        { class: 'summary-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ratio * 100)), 'aria-label': t('summary.waterTitle') },
        h('span', { class: 'summary-meter-fill', style: { '--progress': String(ratio) } }),
      );
      return card({ tone: 'water', iconName: 'water', title: t('summary.waterTitle'), value: formatMl(water.ml), subtitle: [t('summary.waterOf', { goal: formatMl(water.goalMl) }), formatPercent(water.ratio)].join(t('common.dot')), chart: meter, href: '#/water' });
    },
  };
}

function weightDescriptor(summary, todayKey) {
  const weight = summary.weight;
  return {
    id: 'weight',
    sig: [weight.kg, weight.weekChange, weight.logged, weight.at, weight.points],
    build: () => {
      let subtitle = t('summary.weightHint');
      if (weight.logged && weight.weekChange !== null) {
        if (Math.abs(weight.weekChange) < 0.1) subtitle = t('summary.weightSteady');
        else subtitle = t(weight.weekChange < 0 ? 'summary.weightDown' : 'summary.weightUp', { kg: `${formatNumber(Math.abs(weight.weekChange), 1)} ${t('summary.units.kg')}` });
      } else if (weight.logged && weight.at !== null) {
        subtitle = formatRelativeDay(toDateKey(new Date(weight.at)), todayKey);
      }
      const chart = weight.points.length >= 2 ? createSparkline({ points: weight.points.map((point) => ({ at: point.at, value: point.kg })), ariaLabel: t('summary.chartLabel', { title: t('summary.weightTitle') }) }).element : null;
      return card({ tone: 'weight', iconName: 'scale', title: t('summary.weightTitle'), value: formatNumber(weight.kg, 1), unit: t('summary.units.kg'), subtitle, chart, href: '#/body' });
    },
  };
}

function metricDescriptor(id, metric, options, todayKey) {
  if (!metric) return null;
  return {
    id,
    sig: [metric.latest, metric.average, options.extra || null],
    build: () =>
      card({
        tone: options.tone,
        iconName: options.iconName,
        title: options.title,
        value: options.format(metric.latest.value),
        unit: options.unit,
        subtitle: subtitleFor(metric, todayKey, options.format, options.extra),
        href: '#/body',
      }),
  };
}

function distanceDescriptor(summary, todayKey) {
  const distance = summary.distance;
  const flights = summary.flights;
  if (!distance && !flights) return null;
  const options = { tone: 'activity', iconName: 'route', title: t('summary.distanceTitle') };
  if (!distance) return metricDescriptor('distance', flights, { ...options, unit: t('summary.units.flights'), format: (value) => formatNumber(value) }, todayKey);
  const extra = flights ? (flights.latest.value === 1 ? t('summary.flightsOne') : t('summary.flights', { count: formatNumber(flights.latest.value) })) : undefined;
  return metricDescriptor('distance', distance, { ...options, unit: t('summary.units.km'), format: (value) => formatKm(value), extra }, todayKey);
}

function hrvDescriptor(summary, todayKey) {
  const hrv = summary.hrv;
  const breath = summary.respiratory;
  const options = { tone: 'heart', iconName: 'pulse', title: t('summary.hrvTitle') };
  if (!hrv && !breath) return null;
  if (!hrv) return metricDescriptor('hrv', breath, { ...options, unit: t('summary.units.rpm'), format: (value) => formatNumber(value, 1) }, todayKey);
  const extra = breath ? t('summary.respiratory', { value: formatNumber(breath.latest.value, 1) }) : undefined;
  return metricDescriptor('hrv', hrv, { ...options, unit: t('summary.units.ms'), format: (value) => formatNumber(value), extra }, todayKey);
}

function historyDescriptor(summary, state) {
  const history = summary.history;
  if (!history.entries.some((entry) => entry.hours !== null && !entry.isToday)) return null;
  const target = targetFastingHours(state.fasting);
  return {
    id: 'history',
    wide: true,
    sig: [history.streak, history.entries.map((entry) => [entry.hours, entry.onTrack]), target],
    build: () => {
      const streak = history.streak;
      const label = streak === 0 ? t('history.streakZero') : streak === 1 ? t('history.streakOne') : t('history.streak', { count: streak });
      const chart = createBarChart({
        entries: history.entries,
        mini: true,
        maxValue: 24,
        targetValue: target || undefined,
        ariaLabel: t('history.chartLabel'),
        valueOf: (entry) => entry.hours,
        toneOf: (entry) => (entry.hours === null ? 'empty' : entry.onTrack ? 'good' : 'off'),
        titleOf: (entry) => (entry.hours === null ? t('history.barNoData', { day: formatDayShort(entry.key) }) : t('history.bar', { day: formatDayShort(entry.key), hours: formatHours(entry.hours) })),
      }).element;
      return card({ tone: 'history', iconName: 'flame', title: t('summary.historyTitle'), value: String(streak), subtitle: label, chart, href: '#/history' });
    },
  };
}

function statusDescriptor(group, syncing) {
  return {
    id: `status-${group}`,
    wide: true,
    sig: [syncing],
    build: () =>
      h(
        'a',
        { class: 'card summary-status', href: '#/settings' },
        h('span', { class: 'summary-icon', 'aria-hidden': 'true' }, icon(group === 'heart' ? 'heart' : 'walk')),
        h(
          'span',
          { class: 'summary-status-text' },
          h('span', { class: 'summary-title', text: syncing ? t('summary.loadingTitle') : t(group === 'heart' ? 'summary.noDataHeart' : 'summary.noDataActivity') }),
          h('span', { class: 'summary-sub', text: syncing ? t('summary.loadingBody') : t('summary.noDataBody') }),
        ),
        syncing ? h('span', { class: 'summary-spinner', 'aria-hidden': 'true' }) : null,
      ),
  };
}

function moreDescriptor() {
  return {
    id: 'more',
    wide: true,
    sig: [],
    build: () =>
      h(
        'a',
        { class: 'card summary-status summary-more', href: '#/settings' },
        h('span', { class: 'summary-icon', 'aria-hidden': 'true' }, icon('heart')),
        h('span', { class: 'summary-status-text' }, h('span', { class: 'summary-title', text: t('summary.moreTitle') }), h('span', { class: 'summary-sub', text: t('summary.moreBody') })),
        h('span', { class: 'summary-chevron', 'aria-hidden': 'true' }, icon('chevronRight')),
      ),
  };
}

export function summaryLayout(cards, expanded, limit = VISIBLE_CARDS) {
  const visible = expanded ? cards : cards.slice(0, limit);
  const hidden = cards.length - visible.length;
  const odd = visible.length % 2 === 1;
  return { visible: visible.map((item, index) => ({ ...item, wide: odd && index === visible.length - 1 })), hidden, toggle: cards.length > limit };
}

export function createSummaryGrid() {
  const grid = h('div', { class: 'summary-grid' });
  const extras = h('div', { class: 'summary-grid summary-extras' });
  const toggleButton = pressable(h('button', { type: 'button', class: 'button button-ghost summary-toggle', 'aria-expanded': 'false', onClick: () => toggle() }));
  const element = h('section', { class: 'summary-section', 'aria-label': t('summary.title') }, h('h2', { class: 'section-title', text: t('summary.title') }), grid, toggleButton, extras);
  const cache = new Map();
  let first = true;
  let expanded = false;
  let last = null;

  function toggle() {
    expanded = !expanded;
    if (last) update(...last);
  }

  function nodeFor(descriptor, index) {
    const sig = JSON.stringify(descriptor.sig);
    const cached = cache.get(descriptor.id);
    let node = cached && cached.sig === sig ? cached.node : null;
    if (!node) {
      node = descriptor.build();
      if (first) {
        node.classList.add('is-entering');
        node.style.setProperty('--i', String(index));
        node.addEventListener('animationend', () => node.classList.remove('is-entering'), { once: true });
      }
      cache.set(descriptor.id, { sig, node });
    }
    node.classList.toggle('is-wide', Boolean(descriptor.wide));
    return node;
  }

  function place(container, nodes) {
    const current = [...container.children];
    if (current.length === nodes.length && current.every((node, index) => node === nodes[index])) return;
    clear(container);
    container.append(...nodes);
  }

  function update(summary, state, now, options = {}) {
    last = [summary, state, now, options];
    const todayKey = toDateKey(now);
    const groups = state.health;
    const cards = [
      sleepDescriptor(summary),
      waterDescriptor(summary),
      metricDescriptor('steps', summary.steps, { tone: 'activity', iconName: 'walk', title: t('summary.stepsTitle'), unit: t('summary.units.steps'), format: (value) => formatNumber(value) }, todayKey),
      metricDescriptor('active', summary.active, { tone: 'energy', iconName: 'flame', title: t('summary.activeTitle'), unit: t('summary.units.kcal'), format: (value) => formatNumber(value) }, todayKey),
      weightDescriptor(summary, todayKey),
      metricDescriptor(
        'restingHr',
        summary.restingHr,
        {
          tone: 'heart',
          iconName: 'heart',
          title: t('summary.heartTitle'),
          unit: t('summary.units.bpm'),
          format: (value) => formatNumber(value),
          extra: summary.avgHr && summary.restingHr && summary.avgHr.latest.key === summary.restingHr.latest.key ? t('summary.avgHr', { value: formatNumber(summary.avgHr.latest.value) }) : undefined,
        },
        todayKey,
      ),
      metricDescriptor('exercise', summary.exercise, { tone: 'energy', iconName: 'dumbbell', title: t('summary.exerciseTitle'), unit: t('summary.units.min'), format: (value) => formatNumber(value) }, todayKey),
      distanceDescriptor(summary, todayKey),
      hrvDescriptor(summary, todayKey),
    ].filter(Boolean);
    const layout = summaryLayout(cards, expanded);
    const statuses = ['activity', 'heart']
      .filter((group) => groups[group] && !Object.entries(METRIC_GROUPS).some(([id, owner]) => owner === group && cards.some((item) => item.id === id)))
      .map((group) => statusDescriptor(group, Boolean(options.syncing)));
    const showMore = options.healthAvailable && !(groups.activity && groups.heart && state.sleep.healthEnabled);
    const extraCards = [...statuses, showMore ? moreDescriptor() : null, historyDescriptor(summary, state)].filter(Boolean);
    place(grid, layout.visible.map((descriptor, index) => nodeFor(descriptor, index)));
    place(extras, extraCards.map((descriptor, index) => nodeFor(descriptor, layout.visible.length + index)));
    toggleButton.hidden = !layout.toggle;
    toggleButton.textContent = expanded ? t('summary.showLess') : t('summary.showMore', { count: cards.length - VISIBLE_CARDS });
    toggleButton.setAttribute('aria-expanded', String(expanded));
    first = false;
  }

  return {
    element,
    update,
    reset() {},
  };
}
