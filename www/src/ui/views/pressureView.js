import { t } from '../../i18n/index.js';
import { BP_ARMS, BP_LIMITS, categoryStatus, classifyBloodPressure, entryUrgent, validateReading } from '../../core/bloodPressure.js';
import { monthKeyOf, monthlyPressure } from '../../core/measurementReport.js';
import { toDateKey } from '../../core/time.js';
import { createBarChart } from '../components/barChart.js';
import { bigInput, statusPill } from '../components/measureParts.js';
import { subpageHeader } from '../components/subpageHeader.js';
import { clear, h, icon, pressable, prefersReducedMotion, setText } from '../dom.js';
import { segmented } from '../forms.js';
import { formatDateShort, formatTimestamp } from '../format.js';

const CHART_COUNT = 20;
const LIST_LIMIT = 30;
const WAIT_SECONDS = 60;
const URGENT_WINDOW_MS = 24 * 3600000;
const PLACEHOLDERS = { systolic: '120', diastolic: '80', pulse: '70' };
const GUIDE_KEYS = ['rest', 'back', 'feet', 'arm', 'cuff', 'avoid', 'bladder', 'silence', 'twice'];

export function pressureText(entry) {
  return t('pressure.value', { systolic: entry.systolic, diastolic: entry.diastolic });
}

export function urgentCard() {
  return h(
    'section',
    { class: 'card urgent-card', role: 'alert' },
    h('span', { class: 'urgent-icon', 'aria-hidden': 'true' }, icon('heart')),
    h(
      'div',
      { class: 'stack' },
      h('h2', { class: 'card-title', text: t('pressure.urgentTitle') }),
      h('p', { class: 'urgent-action', text: t('pressure.urgentAction') }),
      h('p', { text: t('pressure.urgentBody') }),
      h('a', { class: 'button button-danger pressable urgent-call', href: 'tel:192' }, t('pressure.urgentCall')),
      h('p', { class: 'field-hint', text: t('pressure.notDiagnosis') }),
    ),
  );
}

export function recentUrgent(entries, nowMs) {
  const latest = entries.length ? entries[entries.length - 1] : null;
  return Boolean(latest && latest.source === 'manual' && nowMs - latest.at <= URGENT_WINDOW_MS && entryUrgent(latest));
}

export function createPressureView({ store, measureActions, goBack }) {
  const content = h('div', { class: 'pressure-content' });
  const element = h('section', { class: 'view view-pressure' }, subpageHeader({ title: t('pressure.title'), eyebrow: t('pressure.eyebrow'), backHref: '#/body', backText: t('measure.back'), backLabel: t('measure.backLabel'), goBack }), content);
  let guideOpen = store.state.measurements.bloodPressure.length === 0;
  let chartField = 'systolic';
  let arm = store.state.measurements.lastArm;
  let readings = [{}, {}];
  let lastSaved = null;
  let timer = null;
  let pendingRender = false;
  const secondHolder = { open: false };

  content.addEventListener('focusout', (event) => {
    if (!pendingRender || (event.relatedTarget && content.contains(event.relatedTarget))) return;
    setTimeout(() => {
      if (pendingRender && !isTyping()) render();
    }, 0);
  });

  function isTyping() {
    const active = document.activeElement;
    return Boolean(active && content.contains(active) && active.tagName === 'INPUT');
  }

  function firstComplete() {
    const first = readings[0];
    return validateReading({ systolic: first.systolic, diastolic: first.diastolic, pulse: null }) === null;
  }

  function guideCard() {
    const body = h('div', { class: 'stack', id: 'pressure-guide-body', hidden: !guideOpen }, h('ol', { class: 'check-list is-numbered' }, GUIDE_KEYS.map((key) => h('li', { text: t(`pressure.guide.${key}`) }))), h('p', { class: 'hint-card' }, icon('clock'), h('span', { text: t('pressure.sameTime') })));
    const toggle = pressable(
      h(
        'button',
        {
          type: 'button',
          class: 'disclosure',
          'aria-expanded': String(guideOpen),
          'aria-controls': 'pressure-guide-body',
          onClick: () => {
            guideOpen = !guideOpen;
            toggle.setAttribute('aria-expanded', String(guideOpen));
            body.hidden = !guideOpen;
          },
        },
        h('span', { class: 'card-title', text: t('pressure.guideTitle') }),
        h('span', { class: 'disclosure-chevron', 'aria-hidden': 'true' }, icon('chevronRight')),
      ),
    );
    return h('section', { class: 'card' }, toggle, body);
  }

  function readingBlock(index, error, onChange) {
    const reading = readings[index];
    const fields = ['systolic', 'diastolic', 'pulse'].map((field) => {
      const control = bigInput({
        value: reading[field],
        integer: true,
        unit: '',
        label: t('pressure.fieldWithUnit', { name: t(`pressure.fields.${field}`), unit: field === 'pulse' ? t('measure.units.bpm') : t('measure.units.mmHg') }),
        onInput: (value) => {
          reading[field] = Number.isFinite(value) ? Math.round(value) : undefined;
          setText(error, '');
          if (onChange) onChange();
        },
      });
      control.input.placeholder = PLACEHOLDERS[field];
      return control;
    });
    return h('fieldset', { class: 'pressure-reading' }, h('legend', { class: 'field-label', text: t('pressure.readingTitle', { number: index + 1 }) }), h('div', { class: 'grid-3 pressure-fields' }, fields.map((field) => field.element)));
  }

  function waitButton() {
    const label = h('span', { text: t('pressure.wait') });
    const status = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
    const button = pressable(h('button', { type: 'button', class: 'button button-ghost button-small' }, icon('clock'), label, status));
    button.addEventListener('click', () => {
      clearInterval(timer);
      let left = WAIT_SECONDS;
      button.disabled = true;
      setText(label, t('pressure.waiting', { seconds: left }));
      timer = setInterval(() => {
        left -= prefersReducedMotion() ? 5 : 1;
        if (left <= 0) {
          clearInterval(timer);
          button.disabled = false;
          setText(label, t('pressure.waitDone'));
          setText(status, t('pressure.waitDone'));
          return;
        }
        if (!prefersReducedMotion() || left % 15 === 0) setText(label, t('pressure.waiting', { seconds: left }));
        if (left % 15 === 0) setText(status, t('pressure.waiting', { seconds: left }));
      }, prefersReducedMotion() ? 5000 : 1000);
    });
    return button;
  }

  function parsedReadings() {
    return readings.map((reading) => ({ systolic: reading.systolic, diastolic: reading.diastolic, pulse: Number.isFinite(reading.pulse) ? reading.pulse : null }));
  }

  function formCard() {
    const error = h('p', { class: 'field-error', role: 'alert' });
    secondHolder.open = secondHolder.open || firstComplete() || Object.values(readings[1]).some((value) => Number.isFinite(value));
    const second = h('div', { class: 'stack pressure-second', hidden: !secondHolder.open }, h('div', { class: 'pressure-wait' }, h('p', { class: 'field-hint', text: t('pressure.waitHint') }), waitButton()), readingBlock(1, error));
    const save = () => {
      const [first, second] = parsedReadings();
      const secondFilled = Number.isFinite(second.systolic) || Number.isFinite(second.diastolic) || Number.isFinite(second.pulse);
      const list = secondFilled ? [first, second] : [first];
      for (const reading of list) {
        const problem = validateReading(reading);
        if (problem) {
          setText(error, t(`pressure.errors.${problem}`, { ...BP_LIMITS[problem] }));
          return;
        }
      }
      const outcome = measureActions.addPressure({ readings: list, arm });
      if (!outcome.ok) return;
      lastSaved = outcome.entry;
      readings = [{}, {}];
      secondHolder.open = false;
      render();
      const top = content.querySelector('.urgent-card, .pressure-result');
      if (top) top.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };
    return h(
      'section',
      { class: 'card stack pressure-form' },
      h('h2', { class: 'card-title', text: t('pressure.formTitle') }),
      h('p', { class: 'field-label', text: t('pressure.armLabel') }),
      segmented({ label: t('pressure.armLabel'), value: arm, options: BP_ARMS.map((value) => ({ value, label: t(`pressure.arms.${value}`) })), onChange: (value) => { arm = value; } }),
      readingBlock(0, error, () => {
        if (!secondHolder.open && firstComplete()) {
          secondHolder.open = true;
          second.hidden = false;
        }
      }),
      second,
      error,
      pressable(h('button', { type: 'button', class: 'button button-primary button-large', onClick: save }, icon('plus'), t('pressure.save'))),
    );
  }

  function resultCard(entry) {
    const category = classifyBloodPressure(entry.systolic, entry.diastolic);
    return h(
      'section',
      { class: 'card stack pressure-result', 'aria-live': 'polite' },
      h('p', { class: 'view-eyebrow', text: t('pressure.lastSaved', { count: entry.count }) }),
      h('p', { class: 'pressure-big' }, h('span', { text: pressureText(entry) }), h('span', { class: 'pressure-unit', text: t('measure.units.mmHg') })),
      h('p', { class: 'pressure-sentence', text: t(`pressure.categoryHints.${category}`) }),
      h('div', { class: 'button-row' }, statusPill(categoryStatus(category), categoryStatus(category) === 'good' ? null : 'above'), h('span', { class: 'pressure-category', text: t('pressure.categoryName', { name: t(`pressure.categories.${category}`) }) })),
      h('p', { class: 'disclaimer', text: t('pressure.notDiagnosis') }),
    );
  }

  function chartCard(entries) {
    const recent = entries.slice(-CHART_COUNT).map((entry) => ({ ...entry, key: toDateKey(new Date(entry.at)) }));
    if (recent.length === 0) return null;
    const holder = h('div', { class: 'metric-chart' });
    const draw = () => {
      const target = chartField === 'systolic' ? 120 : 80;
      clear(holder);
      holder.append(
        createBarChart({
          entries: recent,
          maxValue: Math.max(target, ...recent.map((entry) => entry[chartField])) * 1.12,
          gridValues: [],
          targetValue: target,
          targetLabel: t('pressure.targetLine', { value: target }),
          ariaLabel: t('pressure.chartAria', { field: t(`pressure.fields.${chartField}`) }),
          valueOf: (entry) => entry[chartField],
          toneOf: (entry) => (categoryStatus(classifyBloodPressure(entry.systolic, entry.diastolic)) === 'good' ? 'good' : 'off'),
          labelOf: (entry) => String(new Date(entry.at).getDate()),
          titleOf: (entry) => t('pressure.barTitle', { date: formatDateShort(entry.key), time: formatTimestamp(entry.at), value: pressureText(entry) }),
        }).element,
      );
    };
    draw();
    const month = monthlyPressure(entries).get(monthKeyOf(Date.now()));
    return h(
      'section',
      { class: 'card chart-card' },
      h('h2', { class: 'card-title', text: t('pressure.chartTitle') }),
      segmented({ label: t('pressure.chartTitle'), value: chartField, options: ['systolic', 'diastolic'].map((value) => ({ value, label: t(`pressure.fields.${value}`) })), onChange: (value) => { chartField = value; draw(); } }),
      holder,
      month ? h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('pressure.monthAverage', { value: pressureText(month), category: t(`pressure.categories.${classifyBloodPressure(month.systolic, month.diastolic)}`), count: month.count }) })) : null,
    );
  }

  function listCard(entries) {
    const recent = [...entries].reverse().slice(0, LIST_LIMIT);
    if (recent.length === 0) return null;
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: t('pressure.listTitle') }),
      h(
        'ol',
        { class: 'weight-log' },
        recent.map((entry) => {
          const category = classifyBloodPressure(entry.systolic, entry.diastolic);
          const meta = [entry.pulse ? t('pressure.pulseShort', { value: entry.pulse }) : null, entry.arm ? t(`pressure.armsShort.${entry.arm}`) : null, entry.source === 'health' ? t('body.healthLabel') : null].filter(Boolean).join(t('common.dot'));
          return h(
            'li',
            { class: 'weight-log-item pressure-log-item' },
            h('span', { class: 'weight-log-date', text: t('body.logDate', { date: formatDateShort(toDateKey(new Date(entry.at))), time: formatTimestamp(entry.at) }) }),
            h('span', { class: 'weight-log-kg', text: pressureText(entry) }),
            statusPill(categoryStatus(category)),
            h(
              'span',
              { class: 'weight-log-actions' },
              pressable(h('button', { type: 'button', class: 'icon-button', 'aria-label': t('pressure.deleteLabel', { value: pressureText(entry) }), onClick: () => measureActions.deletePressure(entry.id) }, icon('trash'))),
            ),
            meta ? h('span', { class: 'pressure-meta', text: meta }) : null,
          );
        }),
      ),
    );
  }

  function render() {
    const state = store.state;
    const entries = state.measurements.bloodPressure;
    pendingRender = false;
    const latest = lastSaved && entries.some((entry) => entry.id === lastSaved.id) ? lastSaved : null;
    clear(content);
    content.append(
      ...[
        recentUrgent(entries, Date.now()) ? urgentCard() : null,
        latest ? resultCard(latest) : null,
        formCard(),
        guideCard(),
        chartCard(entries),
        listCard(entries),
      ].filter(Boolean),
    );
  }

  return {
    element,
    mounted() {
      render();
    },
    tick() {},
    refresh(reason) {
      if (reason === 'measureDraft' || reason === 'activity' || reason === 'reminder') return;
      if (isTyping()) {
        pendingRender = true;
        return;
      }
      render();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}

