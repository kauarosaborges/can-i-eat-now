import { t, LOCALE } from '../../i18n/index.js';
import { ageOn } from '../../core/body.js';
import { sessionResults } from '../../core/bodyComposition.js';
import { toCsv } from '../../core/csv.js';
import { buildMeasurementReport, previousMonthKey } from '../../core/measurementReport.js';
import { toDateKey } from '../../core/time.js';
import { createWeightChart } from '../components/charts.js';
import { formatDelta, formatMeasure, referenceText, statusDirection, statusPill, statusText } from '../components/measureParts.js';
import { subpageHeader } from '../components/subpageHeader.js';
import { clear, h, icon, pressable } from '../dom.js';
import { confirmDialog, openOverlay } from '../feedback.js';
import { segmented } from '../forms.js';
import { formatTimestamp } from '../format.js';
import { exportCsv } from '../exportFile.js';

const RANGES = [3, 6, 12];
const SECTIONS = [
  { id: 'composition', rows: ['fatJp7', 'fatJp3', 'fatDiff', 'fatNavy', 'fatMass', 'leanMass', 'muscle', 'ffmi', 'bmi', 'weight'] },
  { id: 'girths', rows: ['waist', 'whr', 'whtr', 'neck', 'chest', 'hip', 'armRelaxed', 'armFlexed', 'forearm', 'thigh', 'calf'] },
  { id: 'pressure', rows: ['systolic', 'diastolic', 'pulse'] },
];
const CHARTS = [
  { id: 'fat', rows: ['fatJp7', 'fatJp3', 'fatNavy'] },
  { id: 'leanMass', rows: ['leanMass'] },
  { id: 'muscle', rows: ['muscle'] },
  { id: 'waist', rows: ['waist'] },
  { id: 'systolic', rows: ['systolic'] },
  { id: 'diastolic', rows: ['diastolic'] },
];
const SUMMARY = [
  { id: 'fat', rows: ['fatJp7', 'fatJp3', 'fatNavy'] },
  { id: 'leanMass', rows: ['leanMass'] },
  { id: 'waist', rows: ['waist'] },
];
const GLOSSARY = ['jp', 'ffmi', 'points', 'navy'];
const SESSION_LIMIT = 24;

export function monthLabel(month, long = false) {
  const [year, monthNumber] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat(LOCALE, { month: long ? 'long' : 'short' }).format(new Date(year, monthNumber - 1, 1)).replace('.', '');
  return t(long ? 'report.monthLong' : 'report.monthShort', { month: name, year: long ? String(year) : String(year).slice(2) });
}

export function dayLabel(at) {
  const date = new Date(at);
  const month = new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(date).replace('.', '');
  return t('report.dayShort', { day: date.getDate(), month });
}

function midMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 15).getTime();
}

export function reportContext(state, now) {
  const sessions = state.measurements.sessions;
  const latest = sessions.length ? sessions[sessions.length - 1] : null;
  const profileSex = state.profile.sex === 'female' || state.profile.sex === 'male' ? state.profile.sex : null;
  return { sessions, bloodPressure: state.measurements.bloodPressure, sex: latest ? latest.sex : profileSex, age: latest ? latest.age : ageOn(state.profile, now) };
}

export function deltaText(cell, row) {
  if (cell.delta === null) return '';
  const text = formatDelta(cell.delta, row.unit, row.decimals);
  if (!cell.deltaFrom || cell.deltaFrom === previousMonthKey(cell.month)) return text;
  return t('report.deltaSince', { delta: text, month: monthLabel(cell.deltaFrom) });
}

export function reportCsv(report) {
  const header = [t('report.csv.metric'), t('report.csv.unit'), t('report.csv.reference'), t('report.csv.source'), ...report.months.map((month) => monthLabel(month, true))];
  const rows = report.rows.map((row) => [
    t(`report.rows.${row.id}`),
    t(`measure.units.${row.unit}`),
    referenceText(row.reference, row.unit, row.decimals),
    row.reference ? t(`measure.sources.${row.reference.source}`) : '',
    ...row.cells.map((cell) => (cell.value === null ? '' : { number: cell.value, decimals: row.decimals })),
  ]);
  return toCsv([header, ...rows]);
}

function firstRow(report, ids) {
  return ids.map((id) => report.rows.find((row) => row.id === id)).find((row) => row && row.cells.some((cell) => cell.value !== null)) || null;
}

function lastFilled(row) {
  const cells = row.cells.filter((cell) => cell.value !== null);
  return cells.length ? cells[cells.length - 1] : null;
}

export function createReportView({ store, measureActions, goBack }) {
  const content = h('div', { class: 'report-content' });
  const element = h('section', { class: 'view view-report' }, subpageHeader({ title: t('report.title'), eyebrow: t('report.eyebrow'), backHref: '#/body', backText: t('measure.back'), backLabel: t('measure.backLabel'), goBack }), content);
  let range = 6;
  let chartId = null;

  function summaryCard(report) {
    const items = SUMMARY.map((item) => ({ ...item, row: firstRow(report, item.rows) })).filter((item) => item.row);
    if (items.length === 0) return null;
    const months = report.months.length;
    return h(
      'section',
      { class: 'card report-summary' },
      h('h2', { class: 'card-title', text: t('report.summaryTitle') }),
      h(
        'div',
        { class: 'report-summary-grid' },
        items.map(({ id, row }) => {
          const cell = lastFilled(row);
          const direction = statusDirection(cell.value, row.reference);
          return h(
            'div',
            { class: 'report-summary-item' },
            h('span', { class: 'report-summary-label', text: t(`report.charts.${id}`) }),
            h('span', { class: 'report-summary-value', text: formatMeasure(cell.value, row.unit, row.decimals) }),
            cell.status ? statusPill(cell.status, direction) : null,
            cell.delta !== null ? h('span', { class: 'report-delta', text: deltaText(cell, row) }) : null,
          );
        }),
      ),
      months < 2 ? h('p', { class: 'field-hint', text: t('report.oneMonth') }) : null,
    );
  }

  function cellNode(cell, row) {
    const direction = statusDirection(cell.value, row.reference);
    const status = cell.status ? statusText(cell.status, direction) : '';
    return h(
      'td',
      { class: ['report-cell', cell.status ? `is-${cell.status}` : null], title: status || null },
      cell.value === null
        ? h('span', { class: 'report-value is-empty', 'aria-label': t('report.noMeasure'), text: t('measure.noValue') })
        : h('span', { class: 'report-value', text: formatMeasure(cell.value, row.unit, row.decimals) }),
      status ? h('span', { class: 'report-status', text: status }) : null,
      cell.delta !== null ? h('span', { class: 'report-delta', text: deltaText(cell, row) }) : null,
    );
  }

  function tableCard(report) {
    const columns = report.months.length;
    const head = h('tr', {}, h('th', { scope: 'col', class: 'report-metric', text: t('report.metric') }), report.months.map((month) => h('th', { scope: 'col', text: monthLabel(month) })));
    const bodies = SECTIONS.map((section) => {
      const rows = section.rows.map((id) => report.rows.find((row) => row.id === id)).filter(Boolean);
      if (rows.length === 0) return null;
      return h(
        'tbody',
        { class: 'report-section' },
        h('tr', { class: 'report-section-row' }, h('th', { scope: 'colgroup', colspan: String(columns + 1), class: 'report-section-title' }, h('span', { text: t(`report.sections.${section.id}`) }))),
        rows.map((row) =>
          h(
            'tr',
            {},
            h(
              'th',
              { scope: 'row', class: 'report-metric' },
              h('span', { class: 'report-name', text: t(`report.rows.${row.id}`) }),
              row.reference ? h('span', { class: 'report-ref', text: referenceText(row.reference, row.unit, row.decimals) }) : null,
            ),
            row.cells.map((cell) => cellNode(cell, row)),
          ),
        ),
      );
    });
    const sources = [...new Set(report.rows.filter((row) => row.reference).map((row) => row.reference.source))];
    const scroller = h('div', { class: 'report-scroll', role: 'region', tabindex: '0', 'aria-label': t('report.tableLabel') }, h('table', { class: 'report-table' }, h('caption', { class: 'visually-hidden', text: t('report.tableLabel') }), h('thead', {}, head), bodies));
    requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
    return h(
      'section',
      { class: 'card report-card' },
      h('h2', { class: 'card-title', text: t('report.tableTitle') }),
      segmented({
        label: t('report.rangeLabel'),
        value: range,
        options: RANGES.map((value) => ({ value, label: t('report.range', { count: value }) })),
        onChange: (value) => {
          range = value;
          render();
        },
      }),
      h('ul', { class: 'legend report-legend' }, ['good', 'borderline', 'out'].map((status) => h('li', { class: ['legend-item', `legend-${status}`], text: t(`report.legend.${status}`) }))),
      scroller,
      columns > 1 ? h('p', { class: 'field-hint', text: t('report.scrollHint') }) : null,
      h('dl', { class: 'report-glossary' }, GLOSSARY.map((key) => [h('dt', { text: t(`report.glossary.${key}Term`) }), h('dd', { text: t(`report.glossary.${key}`) })])),
      h('p', { class: 'field-hint', text: t('report.sourcesNote', { sources: sources.map((source) => t(`measure.sources.${source}`)).join(t('common.dot')) }) }),
      h('p', { class: 'disclaimer', text: t('measure.disclaimer') }),
      pressable(
        h(
          'button',
          {
            type: 'button',
            class: 'button button-soft',
            onClick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await exportCsv(reportCsv(report), `${t('report.fileName')}-${toDateKey(new Date())}.csv`);
              } finally {
                button.disabled = false;
              }
            },
          },
          icon('download'),
          t('report.export'),
        ),
      ),
    );
  }

  function chartCard(report) {
    const available = CHARTS.map((chart) => ({ ...chart, row: firstRow(report, chart.rows) })).filter((chart) => chart.row);
    if (available.length === 0) return null;
    if (!available.some((chart) => chart.id === chartId)) chartId = available[0].id;
    const holder = h('div', { class: 'metric-chart' });
    const draw = () => {
      const chart = available.find((item) => item.id === chartId);
      const row = chart.row;
      const filled = row.cells.filter((cell) => cell.value !== null);
      clear(holder);
      if (filled.length < 2) {
        const cell = filled[0];
        holder.append(h('p', { class: 'empty-note', text: t('report.chartOne', { month: monthLabel(cell.month, true), value: formatMeasure(cell.value, row.unit, row.decimals) }) }));
        return;
      }
      const points = filled.map((cell) => ({ at: midMonth(cell.month), kg: cell.value, source: 'manual', title: t('report.pointTitle', { month: monthLabel(cell.month, true), value: formatMeasure(cell.value, row.unit, row.decimals) }) }));
      const first = filled[0].month;
      const last = filled[filled.length - 1].month;
      const target = row.reference && row.reference.good ? row.reference.good.max : undefined;
      holder.append(
        createWeightChart({
          series: points,
          trend: points.map((point) => ({ at: point.at, kg: point.kg })),
          projection: [],
          goalKg: Number.isFinite(target) ? target : null,
          startMs: midMonth(first) - 12 * 86400000,
          endMs: midMonth(last) + 12 * 86400000,
          todayMs: -1,
          ariaLabel: t('report.chartAria', { metric: t(`report.charts.${chart.id}`), values: points.map((point) => point.title).join(t('common.dot')) }),
          formatKg: (value) => formatMeasure(value, 'index', row.decimals),
          labels: { today: '', start: monthLabel(first), end: monthLabel(last), goal: t('report.limitLine') },
        }).element,
      );
    };
    draw();
    return h(
      'section',
      { class: 'card chart-card' },
      h('h2', { class: 'card-title', text: t('report.progressTitle') }),
      segmented({
        label: t('report.progressTitle'),
        value: chartId,
        options: available.map((chart) => ({ value: chart.id, label: t(`report.charts.${chart.id}`) })),
        onChange: (value) => {
          chartId = value;
          draw();
        },
      }),
      holder,
    );
  }

  async function edit(session) {
    if (measureActions.pendingEditFor(session.id)) {
      const confirmed = await confirmDialog({ title: t('report.editPendingTitle'), body: t('report.editPendingBody'), confirmLabel: t('report.editPendingConfirm'), danger: true });
      if (!confirmed) return;
      measureActions.clearDraft(true);
    }
    if (measureActions.startEdit(session.id)) location.hash = '#/measure/edit';
  }

  function openSession(session) {
    const result = sessionResults(session);
    let overlay = null;
    const lines = [
      [t(`measure.results.fatBy.${result.fatSource || 'navy'}`), formatMeasure(result.fatPct, 'pct')],
      [t('measure.results.leanMassKg'), formatMeasure(result.leanMassKg, 'kg')],
      [t('measure.results.waist'), formatMeasure(session.girths.waist, 'cm')],
    ];
    overlay = openOverlay({
      className: 'sheet-panel',
      variant: 'sheet',
      labelledBy: 'session-sheet-title',
      content: [
        h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
        h('h2', { class: 'dialog-title', id: 'session-sheet-title', text: t('report.sessionTitle', { date: dayLabel(session.at), time: formatTimestamp(session.at) }) }),
        h(
          'div',
          { class: 'sheet-body' },
          h('p', { class: 'field-hint', text: t(`measure.protocols.${session.protocol}`) }),
          h('ul', { class: 'result-list' }, lines.map(([label, value]) => h('li', { class: 'result-row' }, h('span', { class: 'result-label', text: label }), h('span', { class: 'result-value', text: value })))),
          pressable(
            h(
              'button',
              {
                type: 'button',
                class: 'button button-ghost sheet-delete',
                onClick: () => {
                  overlay.close(false);
                  measureActions.deleteSession(session.id);
                },
              },
              icon('trash'),
              t('report.deleteSession'),
            ),
          ),
        ),
        h(
          'div',
          { class: 'dialog-actions' },
          pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('common.cancel'), 'data-autofocus': true, onClick: () => overlay.close(false) })),
          pressable(
            h(
              'button',
              {
                type: 'button',
                class: 'button button-primary',
                onClick: () => {
                  overlay.close(true);
                  edit(session);
                },
              },
              icon('pencil'),
              t('report.editSession'),
            ),
          ),
        ),
      ],
    });
  }

  function sessionsCard(state) {
    const sessions = [...state.measurements.sessions].sort((left, right) => right.at - left.at).slice(0, SESSION_LIMIT);
    if (sessions.length === 0) return null;
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: t('report.sessionsTitle') }),
      h(
        'ol',
        { class: 'sleep-rows session-rows' },
        sessions.map((session) => {
          const result = sessionResults(session);
          const day = dayLabel(session.at);
          const value = Number.isFinite(result.fatPct) ? formatMeasure(result.fatPct, 'pct') : formatMeasure(session.girths.waist, 'cm');
          return h(
            'li',
            { class: 'sleep-row' },
            pressable(
              h(
                'button',
                { type: 'button', class: 'sleep-row-inner sleep-row-button session-row', onClick: () => openSession(session), 'aria-label': t('report.sessionOpen', { date: day, protocol: t(`measure.protocols.${session.protocol}`) }) },
                h('span', { class: 'sleep-row-day', text: day }),
                h('span', { class: 'sleep-row-value', text: value }),
                h('span', { class: 'sleep-row-tag', text: t(`measure.protocolsShort.${session.protocol}`) }),
                h('span', { class: 'sleep-row-chevron', 'aria-hidden': 'true' }, icon('chevronRight')),
              ),
            ),
          );
        }),
      ),
    );
  }

  function render() {
    const state = store.state;
    const now = new Date();
    const context = reportContext(state, now);
    clear(content);
    const report = buildMeasurementReport(context, range);
    if (report.rows.length === 0) {
      content.append(
        h(
          'section',
          { class: 'card stack' },
          h('h2', { class: 'card-title', text: t('report.emptyTitle') }),
          h('p', { class: 'field-hint', text: t('report.emptyBody') }),
          h('a', { class: 'button button-primary pressable', href: '#/measure' }, icon('ruler'), t('measure.cta.measure')),
        ),
      );
      return;
    }
    content.append(...[summaryCard(report), tableCard(report), chartCard(buildMeasurementReport(context, 12)), sessionsCard(state)].filter(Boolean));
  }

  return {
    element,
    mounted() {
      render();
    },
    tick() {},
    refresh(reason) {
      if (reason === 'measureDraft' || reason === 'activity' || reason === 'reminder') return;
      render();
    },
    destroy() {},
  };
}
