import { t } from '../../i18n/index.js';
import { FOLD_DIRECTIONS, sessionResults } from '../../core/bodyComposition.js';
import { classify, referenceFor } from '../../core/bodyReferences.js';
import { categoryStatus, classifyBloodPressure } from '../../core/bloodPressure.js';
import { reminderDue, reminderNotificationAt } from '../../core/measurementReminder.js';
import { toDateKey } from '../../core/time.js';
import { h, icon, pressable } from '../dom.js';
import { formatDateShort, formatNumber, formatRelativeDay } from '../format.js';
import { parseDecimal } from '../forms.js';
import { createSilhouette, siteView } from './bodySilhouette.js';

export function formatMeasure(value, unit, decimals = 1) {
  if (!Number.isFinite(value)) return t('measure.noValue');
  return t(`measure.format.${unit}`, { value: formatNumber(value, decimals) });
}

export function formatDelta(value, unit, decimals = 1) {
  if (!Number.isFinite(value)) return '';
  if (Math.round(Math.abs(value) * 10 ** decimals) === 0) return t('measure.deltaZero');
  if (Math.abs(value) < 10 ** -decimals / 2) return t('measure.deltaZero');
  const text = formatMeasure(Math.abs(value), unit === 'pct' ? 'points' : unit, decimals);
  return value > 0 ? t('measure.deltaUp', { value: text }) : t('measure.deltaDown', { value: text });
}

export function statusDirection(value, reference) {
  if (!reference || !reference.good || !Number.isFinite(value)) return null;
  if (reference.good.max !== undefined && value >= reference.good.max) return 'above';
  if (reference.good.min !== undefined && value < reference.good.min) return 'below';
  return null;
}

export function statusText(status, direction) {
  if (!status) return '';
  if (status === 'good' || !direction) return t(`measure.status.${status}`);
  return t(`measure.status.${status}${direction === 'above' ? 'Above' : 'Below'}`);
}

export function statusPill(status, direction = null) {
  if (!status) return null;
  return h('span', { class: ['pill', 'status-pill', `is-${status}`], text: statusText(status, direction) });
}

export function referenceText(reference, unit, decimals = 1) {
  if (!reference || !reference.good) return '';
  const { min, max } = reference.good;
  const fmt = (value) => formatMeasure(value, unit, decimals);
  if (min !== undefined && max !== undefined) return t('measure.reference.between', { min: fmt(min), max: fmt(max) });
  if (max !== undefined) return t('measure.reference.below', { max: fmt(max) });
  return t('measure.reference.above', { min: fmt(min) });
}

export function siteGuide(kind, site, { compact = false, sex = 'male' } = {}) {
  const name = t(`measure.sites.${kind}.${site}.name`);
  const view = t(`measure.views.${siteView(kind, site)}`);
  return h(
    'div',
    { class: ['site-guide', compact ? 'is-compact' : null] },
    h('figure', { class: 'site-figure' }, createSilhouette({ kind, site, sex, label: t('measure.figureLabel', { site: name, view }) }), h('figcaption', { class: 'site-caption', text: t('measure.figureCaption', { view }) })),
    h(
      'div',
      { class: 'site-text' },
      compact ? null : h('h3', { class: 'site-name', text: name }),
      h('p', { class: 'site-how', text: t(`measure.sites.${kind}.${site}.how`) }),
      kind === 'skinfold' && !compact ? h('span', { class: 'pill fold-chip', text: t(`measure.fold.${FOLD_DIRECTIONS[site]}`) }) : null,
    ),
  );
}

export function reminderCard({ store, measureActions, now }) {
  const measurements = store.state.measurements;
  if (!reminderDue(measurements, now)) return null;
  return h(
    'section',
    { class: 'card measure-due-card', 'aria-label': t('measure.due.title') },
    h('span', { class: 'measure-due-icon', 'aria-hidden': 'true' }, icon('ruler')),
    h('div', { class: 'measure-due-text' }, h('h2', { class: 'card-title', text: t('measure.due.title') }), h('p', { class: 'field-hint', text: t('measure.due.body') })),
    h(
      'div',
      { class: 'button-row' },
      h('a', { class: 'button button-primary pressable', href: '#/measure' }, t('measure.due.start')),
      pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('measure.due.later'), onClick: () => measureActions.dismissReminder() })),
    ),
  );
}

export function bigInput({ value, unit, label, onInput, integer = false, decimals = 1 }) {
  const input = h('input', {
    class: 'input measure-input',
    type: 'text',
    inputmode: integer ? 'numeric' : 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'next',
    value: Number.isFinite(value) ? formatNumber(value, integer ? 0 : decimals) : '',
    'aria-label': label,
  });
  input.addEventListener('input', () => onInput(input.value.trim() === '' ? null : parseDecimal(input.value)));
  return {
    input,
    element: h('label', { class: 'measure-input-wrap' }, h('span', { class: 'measure-input-label', text: label }), h('span', { class: 'measure-input-box' }, input, unit ? h('span', { class: 'measure-input-unit', 'aria-hidden': 'true', text: unit }) : null)),
  };
}

function latestFat(sessions) {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const result = sessionResults(sessions[index]);
    if (Number.isFinite(result.fatPct)) return { session: sessions[index], result };
  }
  return null;
}

export function measuresCard({ store, measureActions, now }) {
  const measurements = store.state.measurements;
  const fat = latestFat(measurements.sessions);
  const pressure = measurements.bloodPressure.length ? measurements.bloodPressure[measurements.bloodPressure.length - 1] : null;
  const lines = [];
  if (fat) {
    const context = { sex: fat.session.sex, age: fat.session.age };
    const reference = referenceFor('fat', context);
    lines.push(
      h(
        'li',
        { class: 'result-row' },
        h('span', { class: 'result-label', text: t(`measure.results.fatBy.${fat.result.fatSource}`) }),
        h('span', { class: 'result-value', text: formatMeasure(fat.result.fatPct, 'pct') }),
        statusPill(classify('fat', fat.result.fatPct, context), statusDirection(fat.result.fatPct, reference)),
        h('span', { class: 'result-ref', text: formatRelativeDay(toDateKey(new Date(fat.session.at)), toDateKey(now)) }),
      ),
    );
  }
  if (pressure) {
    const category = classifyBloodPressure(pressure.systolic, pressure.diastolic);
    lines.push(
      h(
        'li',
        { class: 'result-row' },
        h('span', { class: 'result-label', text: t('measure.card.pressure') }),
        h('span', { class: 'result-value', text: t('pressure.value', { systolic: pressure.systolic, diastolic: pressure.diastolic }) }),
        statusPill(categoryStatus(category), categoryStatus(category) === 'good' ? null : 'above'),
        h('span', { class: 'result-ref', text: formatRelativeDay(toDateKey(new Date(pressure.at)), toDateKey(now)) }),
      ),
    );
  }
  const reminder = measurements.reminder;
  const next = reminderNotificationAt(measurements, now);
  const reminderLine = !reminder.enabled ? t('measure.card.reminderOff') : next ? t('measure.card.reminderNext', { date: formatDateShort(toDateKey(next)), time: reminder.time }) : t('measure.card.reminderFirst', { day: reminder.day });
  const entry = (href, iconName, label) => h('a', { class: 'measure-entry pressable', href }, h('span', { class: 'measure-entry-icon', 'aria-hidden': 'true' }, icon(iconName)), h('span', { class: 'measure-entry-label', text: label }));
  return h(
    'section',
    { class: 'card measures-card' },
    h('h2', { class: 'card-title', text: t('measure.card.title') }),
    lines.length ? h('ul', { class: 'result-list' }, lines) : h('p', { class: 'field-hint', text: t('measure.card.empty') }),
    reminderCard({ store, measureActions, now }),
    h(
      'div',
      { class: 'measure-entries' },
      entry('#/measure', 'ruler', measurements.draft ? t('measure.cta.resume') : t('measure.cta.measure')),
      entry('#/guides', 'book', t('measure.cta.guides')),
      entry('#/report', 'history', t('measure.cta.report')),
      entry('#/pressure', 'heart', t('measure.cta.pressure')),
    ),
    h('a', { class: 'field-hint measure-reminder-link', href: '#/settings' }, icon('bell'), h('span', { text: reminderLine })),
  );
}
