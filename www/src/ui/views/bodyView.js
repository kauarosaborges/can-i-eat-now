import { t } from '../../i18n/index.js';
import { SEX_OPTIONS, WEIGHT_LIMITS, birthDateRange, isPlausibleBirthDate, latestBodyFat, latestWeightKg } from '../../core/body.js';
import { effectiveHeightCm, energyHistory, forecastTomorrow, goalEstimate, weightProjection } from '../../core/energy.js';
import { LIMITS } from '../../core/storage.js';
import { MS_PER_HOUR, addDaysToKey, clampNumber, dateAtMinutes, toDateKey, weekdayOfKey } from '../../core/time.js';
import { createBarChart } from '../components/barChart.js';
import { createBalanceBars, createStackedBars, createWeightChart } from '../components/charts.js';
import { clear, h, icon, pressable, setText } from '../dom.js';
import { confirmDialog, openOverlay, showToast } from '../feedback.js';
import { field, numberInput, onPickerCommit } from '../forms.js';
import { formatDateShort, formatDayShort, formatKcal, formatKg, formatNumber, formatTimestamp } from '../format.js';

const DAY_MS = 24 * MS_PER_HOUR;
const LOG_LIMIT = 30;

function parseKg(text) {
  const value = Number.parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(value) ? value : NaN;
}

function decimalInput(value, placeholder, onCommit) {
  const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: value === null || value === undefined ? '' : formatNumber(value, 1), placeholder });
  input.addEventListener('change', () => {
    const text = input.value.trim();
    if (text === '') {
      onCommit(null);
      return;
    }
    const parsed = parseKg(text);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else input.value = value === null || value === undefined ? '' : formatNumber(value, 1);
  });
  return input;
}

function signedKcal(value) {
  return value > 0 ? t('body.plusKcal', { value: formatNumber(Math.round(value)) }) : formatKcal(value);
}

export function createBodyView({ store, bodyActions }) {
  const content = h('div', { class: 'body-content' });
  const element = h(
    'section',
    { class: 'view view-body' },
    h('header', { class: 'view-header' }, h('p', { class: 'view-eyebrow', text: t('body.eyebrow') }), h('h1', { class: 'view-title', text: t('body.title') })),
    content,
  );
  let renderedSignature = '';
  let pendingKg = null;
  let pendingRender = false;
  content.addEventListener('focusout', (event) => {
    if (!pendingRender || (event.relatedTarget && content.contains(event.relatedTarget))) return;
    setTimeout(() => {
      if (pendingRender && !content.contains(document.activeElement)) render();
    }, 0);
  });

  function weightCard(state, now, projection) {
    const latest = latestWeightKg(state);
    const trend = projection.trend;
    const trendNow = trend.length > 0 ? trend[trend.length - 1].trend : null;
    const weekAgo = [...trend].reverse().find((point) => now.getTime() - point.at >= 6.5 * DAY_MS);
    const change = trendNow !== null && weekAgo ? trendNow - weekAgo.trend : null;
    if (pendingKg === null) pendingKg = latest;
    const input = h('input', { class: 'input weight-input', type: 'text', inputmode: 'decimal', value: formatNumber(pendingKg, 1), 'aria-label': t('body.weightInput') });
    const error = h('p', { class: 'field-error', role: 'alert' });
    const stepBy = (delta) => {
      const current = parseKg(input.value);
      pendingKg = Math.round(clampNumber((Number.isFinite(current) ? current : latest) + delta, WEIGHT_LIMITS.min, WEIGHT_LIMITS.max, latest) * 10) / 10;
      input.value = formatNumber(pendingKg, 1);
    };
    input.addEventListener('change', () => {
      const value = parseKg(input.value);
      if (Number.isFinite(value)) pendingKg = value;
    });
    let busy = false;
    const submit = async (event) => {
      if (busy) return;
      const button = event.currentTarget;
      const value = parseKg(input.value);
      if (!Number.isFinite(value) || value < WEIGHT_LIMITS.min || value > WEIGHT_LIMITS.max) {
        setText(error, t('body.weightInvalid', { min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max }));
        return;
      }
      busy = true;
      button.disabled = true;
      try {
        let confirmed = false;
        if (bodyActions.needsConfirmation(value)) {
          confirmed = await confirmDialog({ title: t('body.jumpTitle', { kg: formatKg(value) }), body: t('body.jumpBody'), confirmLabel: t('body.jumpConfirm') });
          if (!confirmed) return;
        }
        const result = bodyActions.addWeight(value, { confirmed });
        if (!result.ok) {
          if (result.reason === 'invalid') setText(error, t('body.weightInvalid', { min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max }));
          return;
        }
        setText(error, '');
        pendingKg = null;
      } finally {
        busy = false;
        button.disabled = false;
      }
    };
    return h(
      'section',
      { class: 'card weight-card' },
      h(
        'div',
        { class: 'weight-summary' },
        h('span', { class: 'weight-value', text: formatKg(latest) }),
        h('span', { class: 'weight-meta', text: trendNow === null ? t('body.noTrend') : t('body.trendNow', { kg: formatKg(trendNow) }) }),
        change === null ? null : h('span', { class: ['weight-change', change <= 0 ? 'is-down' : 'is-up'], text: t('body.weekChange', { kg: formatKg(Math.abs(change)), sign: change <= 0 ? t('body.down') : t('body.up') }) }),
      ),
      h(
        'div',
        { class: 'weight-stepper' },
        pressable(h('button', { type: 'button', class: 'stepper-button', 'aria-label': t('body.minus'), onClick: () => stepBy(-0.1) }, t('body.minusSymbol'))),
        input,
        pressable(h('button', { type: 'button', class: 'stepper-button', 'aria-label': t('body.plus'), onClick: () => stepBy(0.1) }, t('body.plusSymbol'))),
      ),
      error,
      pressable(h('button', { type: 'button', class: 'button button-primary button-large', onClick: submit }, icon('plus'), t('body.logWeight'))),
    );
  }

  function forecastCard(state, now) {
    const forecast = forecastTomorrow(state, now);
    const lines = [
      t('body.balanceToday', { kcal: signedKcal(forecast.balance) }),
      t('body.sources', { expenditure: t(`body.source.${forecast.expenditure.source}`), intake: t(`body.source.${forecast.intake.source}`) }),
    ];
    if (Math.abs(forecast.glycogenKg) >= 0.1) lines.push(forecast.glycogenKg < 0 ? t('body.glycogenDrop', { kg: formatKg(-forecast.glycogenKg) }) : t('body.glycogenRebound', { kg: formatKg(forecast.glycogenKg) }));
    return h(
      'section',
      { class: 'card forecast-card' },
      h('h2', { class: 'card-title', text: t('body.forecastTitle') }),
      h('p', { class: 'forecast-value', text: t('body.forecastValue', { kg: formatKg(forecast.kg) }) }),
      h('p', { class: 'forecast-range', text: t('body.forecastRange', { low: formatKg(forecast.low), high: formatKg(forecast.high) }) }),
      h('ul', { class: 'forecast-lines' }, lines.map((line) => h('li', { text: line }))),
      h('p', { class: 'disclaimer', text: t('body.forecastDisclaimer') }),
    );
  }

  function trendCard(state, now, projection) {
    const todayKey = toDateKey(now);
    const startMs = dateAtMinutes(addDaysToKey(todayKey, -30), 0).getTime();
    const endMs = dateAtMinutes(addDaysToKey(todayKey, 28), 0).getTime();
    const series = state.body.weights
      .filter((entry) => entry.at >= startMs)
      .map((entry) => ({ at: entry.at, kg: entry.kg, source: entry.source, title: t('body.pointTitle', { date: formatDateShort(toDateKey(new Date(entry.at))), kg: formatKg(entry.kg) }) }));
    const trend = projection.trend.filter((point) => point.at >= startMs).map((point) => ({ at: point.at, kg: point.trend }));
    const projectionPoints = projection.points.length > 0 ? [{ at: now.getTime(), kg: projection.start }, ...projection.points.map((point) => ({ at: dateAtMinutes(point.key, 7 * 60).getTime(), kg: point.kg }))] : [];
    const weekly = projection.slope === null ? null : projection.slope * 7;
    const chart = series.length + trend.length + projectionPoints.length === 0
      ? h('p', { class: 'empty-note', text: t('body.chartEmpty') })
      : createWeightChart({
          series,
          trend,
          projection: projectionPoints,
          goalKg: state.body.goalKg,
          startMs,
          endMs,
          todayMs: now.getTime(),
          ariaLabel: t('body.chartLabel'),
          formatKg: (value) => formatNumber(value, 1),
          labels: { today: t('body.today'), start: formatDateShort(addDaysToKey(todayKey, -30)), end: formatDateShort(addDaysToKey(todayKey, 28)), goal: t('body.goalLine') },
        }).element;
    return h(
      'section',
      { class: 'card chart-card' },
      h('h2', { class: 'card-title', text: t('body.trendTitle') }),
      chart,
      h(
        'ul',
        { class: 'legend' },
        h('li', { class: 'legend-item legend-dot', text: t('body.legendWeighIn') }),
        h('li', { class: 'legend-item legend-trend', text: t('body.legendTrend') }),
        h('li', { class: 'legend-item legend-projection', text: t('body.legendProjection') }),
      ),
      h('p', { class: 'field-note', text: weekly === null ? t('body.paceUnknown') : t(`body.pace.${projection.source}`, { kg: formatKg(Math.abs(weekly), 2), direction: weekly <= 0 ? t('body.losing') : t('body.gaining') }) }),
    );
  }

  function goalCard(state, now, projection) {
    const goal = state.body.goalKg;
    const estimate = goalEstimate({ goalKg: goal, currentKg: projection.start, slope: projection.slope, weighIns: projection.weighIns, now });
    const input = decimalInput(goal, t('body.goalPlaceholder'), (value) => bodyActions.setGoal(value));
    let text;
    if (estimate.status === 'estimated') text = t('body.goalDate', { date: formatDateShort(estimate.date), days: estimate.days });
    else text = t(`body.goalStatus.${estimate.status}`);
    return h(
      'section',
      { class: 'card goal-card' },
      h('h2', { class: 'card-title', text: t('body.goalTitle') }),
      field(t('body.goalLabel'), input),
      h('p', { class: ['goal-estimate', `status-${estimate.status}`], text }),
      goal === null ? null : pressable(h('button', { type: 'button', class: 'button button-small button-ghost', text: t('body.goalClear'), onClick: () => bodyActions.setGoal(null) })),
    );
  }

  function energyCard(state, now) {
    const history = energyHistory(state, now, 14).map((day) => ({ ...day, isToday: day.key === toDateKey(now) }));
    const label = (entry) => t(`days.initial.${weekdayOfKey(entry.key)}`);
    const maxExpenditure = Math.max(1500, ...history.map((entry) => entry.expenditure.total)) * 1.1;
    const expenditure = createStackedBars({
      entries: history,
      ariaLabel: t('body.expenditureLabel'),
      labelOf: label,
      maxValue: maxExpenditure,
      axisFormat: (value) => formatNumber(value / 1000, 1),
      markerOf: (entry) => entry.workouts.length > 0,
      titleOf: (entry) => t('body.expenditureTitle', { day: formatDayShort(entry.key), kcal: formatKcal(entry.expenditure.total), source: t(`body.source.${entry.expenditure.source}`) }),
      layers: [
        { className: 'segment-basal', valueOf: (entry) => entry.expenditure.basal },
        { className: 'segment-active', valueOf: (entry) => entry.expenditure.active },
      ],
    });
    const balance = createBalanceBars({
      entries: history,
      ariaLabel: t('body.balanceLabel'),
      labelOf: label,
      axisFormat: (value) => signedKcal(value),
      valueOf: (entry) => entry.balance,
      titleOf: (entry) => t('body.balanceTitle', { day: formatDayShort(entry.key), kcal: signedKcal(entry.balance), intake: t(`body.source.${entry.intake.source}`) }),
    });
    const hasSteps = history.some((entry) => Number.isFinite(entry.steps));
    const steps = hasSteps
      ? createBarChart({
          entries: history,
          maxValue: Math.max(5000, ...history.map((entry) => entry.steps || 0)) * 1.1,
          gridValues: [],
          targetValue: 8000,
          targetLabel: t('body.stepsTarget'),
          ariaLabel: t('body.stepsLabel'),
          valueOf: (entry) => entry.steps,
          toneOf: (entry) => (Number.isFinite(entry.steps) ? 'water' : 'empty'),
          labelOf: label,
          titleOf: (entry) => t('body.stepsTitle', { day: formatDayShort(entry.key), steps: formatNumber(entry.steps || 0) }),
        }).element
      : h('p', { class: 'field-hint', text: t('body.stepsEmpty') });
    return h(
      'section',
      { class: 'card energy-card' },
      h('h2', { class: 'card-title', text: t('body.energyTitle') }),
      h('h3', { class: 'chart-subtitle', text: t('body.expenditureTitleShort') }),
      expenditure.element,
      h('ul', { class: 'legend' }, h('li', { class: 'legend-item legend-basal', text: t('body.legendBasal') }), h('li', { class: 'legend-item legend-active', text: t('body.legendActive') }), h('li', { class: 'legend-item legend-workout', text: t('body.legendWorkout') })),
      h('h3', { class: 'chart-subtitle', text: t('body.balanceTitleShort') }),
      balance.element,
      h('ul', { class: 'legend' }, h('li', { class: 'legend-item legend-deficit', text: t('body.legendDeficit') }), h('li', { class: 'legend-item legend-surplus', text: t('body.legendSurplus') })),
      h('h3', { class: 'chart-subtitle', text: t('body.stepsTitleShort') }),
      steps,
    );
  }

  function profileCard(state) {
    const profile = state.profile;
    const sex = h('select', { class: 'input' }, SEX_OPTIONS.map((value) => h('option', { value, selected: value === profile.sex || null, text: t(`profile.sexes.${value}`) })));
    sex.addEventListener('change', () => bodyActions.updateProfile({ sex: sex.value }));
    const birthRange = birthDateRange(new Date());
    const birth = h('input', { class: 'input', type: 'date', min: birthRange.min, max: birthRange.max, value: profile.birthDate || '' });
    let savedBirth = profile.birthDate || '';
    onPickerCommit(birth, () => {
      if (birth.value !== '' && !isPlausibleBirthDate(birth.value, new Date())) {
        birth.value = savedBirth;
        showToast(t('body.birthDateInvalid'));
        return;
      }
      savedBirth = birth.value;
      bodyActions.updateProfile({ birthDate: birth.value || null });
    });
    const fat = latestBodyFat(state);
    return h(
      'section',
      { class: 'card body-profile-card' },
      h('h2', { class: 'card-title', text: t('body.profileTitle') }),
      h(
        'div',
        { class: 'grid-2' },
        field(t('profile.height'), numberInput({ value: effectiveHeightCm(state), limits: LIMITS.heightCm, onCommit: (value) => bodyActions.updateProfile({ heightCm: value }) })),
        field(t('body.bodyFat'), decimalInput(fat, t('body.bodyFatPlaceholder'), (value) => { if (value !== null && !bodyActions.setBodyFat(value)) render(); })),
        field(t('body.birthDate'), birth),
        field(t('profile.sex'), sex),
      ),
      h('p', { class: 'field-hint', text: profile.heightSource !== 'manual' && Number.isFinite(state.body.healthHeightCm) ? t('body.heightFromHealth') : t('body.profileHint') }),
    );
  }

  function editWeight(entry) {
    const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: formatNumber(entry.kg, 1), 'aria-label': t('body.weightInput'), 'data-autofocus': true });
    const error = h('p', { class: 'field-error', role: 'alert' });
    let overlay = null;
    overlay = openOverlay({
      className: 'sheet-panel',
      variant: 'sheet',
      labelledBy: 'edit-weight-title',
      content: [
        h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
        h('h2', { class: 'dialog-title', id: 'edit-weight-title', text: t('body.editTitle', { date: formatDateShort(toDateKey(new Date(entry.at))), time: formatTimestamp(entry.at) }) }),
        h('div', { class: 'sheet-body' }, input, error),
        h(
          'div',
          { class: 'dialog-actions' },
          pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('common.cancel'), onClick: () => overlay.close(false) })),
          pressable(
            h('button', {
              type: 'button',
              class: 'button button-primary',
              text: t('body.save'),
              onClick: () => {
                const value = parseKg(input.value);
                if (!Number.isFinite(value) || value < WEIGHT_LIMITS.min || value > WEIGHT_LIMITS.max) {
                  setText(error, t('body.weightInvalid', { min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max }));
                  return;
                }
                const result = bodyActions.updateWeight(entry.id, value);
                if (!result.ok) {
                  setText(error, t('body.weightInvalid', { min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max }));
                  return;
                }
                overlay.close(true);
              },
            }),
          ),
        ),
      ],
    });
  }

  function logCard(state) {
    const entries = [...state.body.weights].sort((left, right) => right.at - left.at).slice(0, LOG_LIMIT);
    return h(
      'section',
      { class: 'card weight-log-card' },
      h('h2', { class: 'card-title', text: t('body.logTitle') }),
      entries.length === 0
        ? h('p', { class: 'empty-note', text: t('body.logEmpty') })
        : h(
            'ol',
            { class: 'weight-log' },
            entries.map((entry) =>
              h(
                'li',
                { class: 'weight-log-item' },
                h('span', { class: 'weight-log-date', text: t('body.logDate', { date: formatDateShort(toDateKey(new Date(entry.at))), time: formatTimestamp(entry.at) }) }),
                h('span', { class: 'weight-log-kg', text: formatKg(entry.kg) }),
                entry.source === 'health' ? h('span', { class: 'pill', text: t('body.healthLabel') }) : null,
                h(
                  'span',
                  { class: 'weight-log-actions' },
                  entry.source === 'manual' ? pressable(h('button', { type: 'button', class: 'icon-button', 'aria-label': t('body.edit'), onClick: () => editWeight(entry) }, icon('settings'))) : null,
                  pressable(
                    h('button', {
                      type: 'button',
                      class: 'icon-button',
                      'aria-label': t('body.delete'),
                      onClick: async () => {
                        if (bodyActions.isInHealth(entry)) {
                          const confirmed = await confirmDialog({ title: t('body.deleteHealthTitle'), body: t('body.deleteHealthBody'), confirmLabel: t('body.delete'), danger: true });
                          if (!confirmed) return;
                        }
                        bodyActions.deleteWeight(entry.id);
                      },
                    }, icon('trash')),
                  ),
                ),
              ),
            ),
          ),
    );
  }

  function render() {
    pendingRender = false;
    const now = new Date();
    const state = store.state;
    const projection = weightProjection(state, now);
    renderedSignature = `${toDateKey(now)}:${now.getHours()}`;
    clear(content);
    content.append(
      ...[
        weightCard(state, now, projection),
        forecastCard(state, now),
        trendCard(state, now, projection),
        goalCard(state, now, projection),
        energyCard(state, now),
        profileCard(state),
        logCard(state),
      ].filter(Boolean),
    );
  }

  return {
    element,
    mounted() {
      render();
      bodyActions.syncHealth();
    },
    tick(now) {
      if (`${toDateKey(now)}:${now.getHours()}` !== renderedSignature && !content.contains(document.activeElement)) render();
    },
    refresh(reason) {
      if (reason === 'activity' || reason === 'reminder') return;
      if (content.contains(document.activeElement) && document.activeElement !== document.body && reason !== 'body') {
        pendingRender = true;
        return;
      }
      render();
    },
    destroy() {},
  };
}
