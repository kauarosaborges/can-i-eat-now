import { hasKey, t } from '../../i18n/index.js';
import {
  GIRTH_LIMITS,
  GIRTH_SITES,
  MAX_READINGS,
  SKINFOLD_LIMITS,
  cleanSkippedSites,
  inconsistentReadings,
  isSiteComplete,
  isValidGirth,
  navyGirthSites,
  isValidSkinfold,
  needsThirdReading,
  FOLD_DIRECTIONS,
  optionalSkinfoldSites,
  protocolSites,
  sessionResults,
  siteValue,
} from '../../core/bodyComposition.js';
import { WEIGHT_LIMITS } from '../../core/body.js';
import { effectiveHeightCm } from '../../core/energy.js';
import { classify, referenceFor } from '../../core/bodyReferences.js';
import { monthKeyOf } from '../../core/measurementReport.js';
import { toDateKey } from '../../core/time.js';
import { createCaliperSteps, createPinchDiagram } from '../components/pinchDiagram.js';
import { subpageHeader } from '../components/subpageHeader.js';
import { bigInput, fallbackNote, formatDelta, formatMeasure, referenceText, siteGuide, statusPill } from '../components/measureParts.js';
import { clear, h, icon, pressable, setText } from '../dom.js';
import { confirmDialog } from '../feedback.js';
import { segmented } from '../forms.js';
import { formatDateShort, formatKg, formatNumber } from '../format.js';
import { freshWeight, newDraft, sessionFromDraft } from '../measureActions.js';

const SAVE_DELAY_MS = 300;
const RESULT_ROWS = [
  { id: 'fatPct', unit: 'pct', reference: 'fat' },
  { id: 'fatMassKg', unit: 'kg' },
  { id: 'leanMassKg', unit: 'kg' },
  { id: 'muscleKg', unit: 'kg' },
  { id: 'ffmi', unit: 'index', reference: 'ffmi' },
  { id: 'bmi', unit: 'index', reference: 'bmi' },
  { id: 'whr', unit: 'ratio', reference: 'whr', decimals: 2 },
  { id: 'whtr', unit: 'ratio', reference: 'whtr', decimals: 2 },
];

function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

export function skippedSites(draft) {
  if (draft.protocol === 'tape') return [];
  return cleanSkippedSites(draft.skippedSkinfolds, protocolSites(draft.protocol, draft.sex || 'male')).filter((site) => !(draft.skinfolds[site] && draft.skinfolds[site].length));
}

export function buildSteps(draft) {
  const steps = [{ type: 'setup' }];
  const sex = draft.sex || 'male';
  if (draft.protocol !== 'tape') {
    steps.push({ type: 'caliperIntro' });
    for (const site of protocolSites(draft.protocol, sex)) steps.push({ type: 'skinfold', site, optional: false });
    for (const site of optionalSkinfoldSites(draft.protocol, sex)) steps.push({ type: 'skinfold', site, optional: true });
  }
  const navySites = skippedSites(draft).length > 0 ? navyGirthSites(sex) : [];
  for (const site of GIRTH_SITES) steps.push({ type: 'girth', site, optional: true, navy: navySites.includes(site) });
  steps.push({ type: 'results' });
  return steps;
}

export function createMeasureView({ store, measureActions, goBack }) {
  const editing = /^#\/measure\/edit/.test(location.hash);
  const slot = editing ? 'editDraft' : 'draft';
  const progressText = h('p', { class: 'measure-progress-text' });
  const progressFill = h('span', { class: 'measure-progress-fill' });
  const progressBar = h('div', { class: 'measure-progress-track', role: 'progressbar', 'aria-valuemin': '1', 'aria-label': t('measure.progressLabel') }, progressFill);
  const stepHolder = h('div', { class: 'measure-step-holder' });
  const navHolder = h('div', { class: 'measure-nav-bar' });
  const flow = h('div', { class: 'measure-flow' }, h('div', { class: 'measure-progress' }, progressText, progressBar), stepHolder, navHolder);
  const restart = pressable(h('button', { type: 'button', class: 'button button-small button-ghost', text: editing ? t('measure.discardEdit') : t('measure.restart'), onClick: () => askRestart() }));
  const title = editing ? t('measure.editTitle') : t('measure.title');
  const element = h('section', { class: 'view view-measure' }, subpageHeader({ title, eyebrow: t('measure.eyebrow'), backHref: editing ? '#/report' : '#/body', backText: editing ? t('report.title') : t('measure.back'), backLabel: editing ? t('report.title') : t('measure.backLabel'), goBack: editing ? null : goBack, actions: restart }), flow);
  const saved = store.state.measurements[slot];
  let draft = saved ? cloneDraft(saved) : editing ? null : newDraft(store.state, new Date());
  let resumed = Boolean(saved) && !editing;
  let saveTimer = null;
  let dirty = false;
  let saving = false;
  let lastRatio = -1;
  let lastIndex = -1;

  function persist() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    measureActions.saveDraft(draft);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') flush();
  }
  document.addEventListener('visibilitychange', onVisibility);

  async function askRestart() {
    const confirmed = await confirmDialog({ title: t('measure.restartTitle'), body: t('measure.restartBody'), confirmLabel: t('measure.restartConfirm'), danger: true });
    if (!confirmed) return;
    clearTimeout(saveTimer);
    dirty = false;
    measureActions.clearDraft(editing);
    if (editing) {
      location.hash = '#/report';
      return;
    }
    draft = newDraft(store.state, new Date());
    resumed = false;
    render(true);
  }

  function goTo(index) {
    const steps = buildSteps(draft);
    draft.step = Math.max(0, Math.min(steps.length - 1, index));
    persist();
    render(true);
  }

  function updateProgress(steps, index) {
    const ratio = steps.length > 1 ? index / (steps.length - 1) : 1;
    const stage = steps[index].type;
    const sameStage = steps.filter((item) => item.type === stage);
    const label = stage === 'skinfold' || stage === 'girth' ? t(`measure.stage.${stage}`, { step: sameStage.indexOf(steps[index]) + 1, total: sameStage.length }) : t(`measure.stage.${stage}`);
    setText(progressText, label);
    progressBar.setAttribute('aria-valuemax', String(steps.length));
    progressBar.setAttribute('aria-valuenow', String(index + 1));
    progressBar.setAttribute('aria-valuetext', t('measure.stepOf', { step: index + 1, total: steps.length }));
    progressFill.classList.toggle('is-instant', ratio < lastRatio);
    progressFill.style.setProperty('--progress', String(ratio));
    lastRatio = ratio;
  }

  function navRow({ index, onNext, nextLabel, optional, nextIcon = 'chevronRight' }) {
    return h(
      'div',
      { class: 'measure-nav' },
      index > 0 ? pressable(h('button', { type: 'button', class: 'button button-ghost', onClick: () => goTo(index - 1) }, icon('chevronLeft'), t('measure.prev'))) : null,
      optional ? pressable(h('button', { type: 'button', class: 'button button-soft', text: t('measure.skip'), onClick: () => onNext(true) })) : null,
      pressable(h('button', { type: 'button', class: 'button button-primary measure-next', onClick: () => onNext(false) }, nextLabel || t('measure.next'), icon(nextIcon))),
    );
  }

  function onEnter(event) {
    if (event.key !== 'Enter' || !event.target.classList || !event.target.classList.contains('measure-input')) return;
    event.preventDefault();
    const inputs = [...stepHolder.querySelectorAll('.measure-input')].filter((input) => input.offsetParent !== null);
    const position = inputs.indexOf(event.target);
    const nextEmpty = inputs.slice(position + 1).find((input) => input.value.trim() === '');
    if (nextEmpty) {
      nextEmpty.focus();
      return;
    }
    const next = navHolder.querySelector('.measure-next');
    if (next) next.click();
  }
  flow.addEventListener('keydown', onEnter);

  function setupStep(steps, index) {
    const state = store.state;
    const now = new Date();
    const error = h('p', { class: 'field-error', role: 'alert' });
    const protocolNote = h('p', { class: 'field-hint' });
    const refreshProtocolNote = () => setText(protocolNote, t(`measure.protocols.${draft.protocol}Hint`));
    refreshProtocolNote();
    const fresh = freshWeight(state, now);
    const weight = bigInput({
      value: draft.weightKg,
      unit: t('measure.units.kg'),
      label: fresh ? t('measure.weightOptional') : t('measure.weightToday'),
      onInput: (value) => {
        draft.weightKg = Number.isFinite(value) ? value : null;
        persist();
      },
    });
    weight.input.placeholder = fresh ? formatNumber(fresh.kg, 1) : '';
    const profileSex = state.profile.sex === 'female' || state.profile.sex === 'male';
    if (profileSex && draft.sex !== state.profile.sex && !editing) draft.sex = state.profile.sex;
    const sexBlock = profileSex && !editing
      ? h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('measure.sexFromProfile', { sex: t(`profile.sexes.${draft.sex}`) }) }))
      : h(
          'div',
          { class: 'stack' },
          h('p', { class: 'field-label', text: t('measure.sexLabel') }),
          segmented({
            label: t('measure.sexLabel'),
            value: draft.sex,
            options: ['female', 'male'].map((value) => ({ value, label: t(`profile.sexes.${value}`) })),
            onChange: (value) => {
              draft.sex = value;
              if (!editing) measureActions.setSex(value);
              setText(error, '');
              persist();
            },
          }),
          h('p', { class: 'field-hint', text: editing ? t('measure.sexEditHint') : t('measure.sexHint') }),
        );
    const next = () => {
      if (draft.sex !== 'female' && draft.sex !== 'male') {
        setText(error, t('measure.sexRequired'));
        return;
      }
      if (draft.weightKg !== null && (!Number.isFinite(draft.weightKg) || draft.weightKg < WEIGHT_LIMITS.min || draft.weightKg > WEIGHT_LIMITS.max)) {
        setText(error, t('body.weightInvalid', { min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max }));
        return;
      }
      goTo(index + 1);
    };
    return [
      resumed ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('measure.resumed', { date: formatDateShort(toDateKey(new Date(draft.updatedAt))) }) })) : null,
      draft.editingId ? h('p', { class: 'hint-card' }, icon('pencil'), h('span', { text: t('measure.editing', { date: formatDateShort(toDateKey(new Date(draft.editingAt))) }) })) : null,
      h(
        'section',
        { class: 'card stack' },
        h('h2', { class: 'card-title', text: t('measure.setupTitle') }),
        h('ul', { class: 'check-list' }, ['sameTime', 'fasting', 'rightSide', 'drySkin', 'helper'].map((key) => h('li', { text: t(`measure.checklist.${key}`) }))),
        h('a', { class: 'button button-ghost button-small pressable', href: '#/guides' }, icon('book'), t('measure.openGuides')),
      ),
      h(
        'section',
        { class: 'card stack' },
        h('p', { class: 'field-label', text: t('measure.protocolLabel') }),
        segmented({
          label: t('measure.protocolLabel'),
          value: draft.protocol,
          options: ['jp7', 'jp3', 'tape'].map((value) => ({ value, label: t(`measure.protocols.${value}`) })),
          onChange: (value) => {
            draft.protocol = value;
            refreshProtocolNote();
            persist();
          },
        }),
        protocolNote,
        sexBlock,
        weight.element,
        h('p', { class: 'field-hint', text: editing ? t('measure.weightEditHint') : fresh ? t('measure.weightFresh', { kg: formatKg(fresh.kg), date: formatDateShort(toDateKey(new Date(fresh.at))) }) : t('measure.weightMissing') }),
        h('p', { class: 'field-label', text: t('measure.waistLabel') }),
        segmented({
          label: t('measure.waistLabel'),
          value: draft.waistSite,
          options: ['navel', 'who'].map((value) => ({ value, label: t(`measure.waistSites.${value}`) })),
          onChange: (value) => {
            draft.waistSite = value;
            persist();
          },
        }),
        h('p', { class: 'field-hint', text: t('measure.waistHint') }),
        error,
      ),
      { nav: navRow({ index, onNext: next, nextLabel: t('measure.start') }) },
    ];
  }

  function caliperIntroStep(index) {
    return [
      h(
        'section',
        { class: 'card stack measure-step' },
        h('p', { class: 'view-eyebrow', text: t('measure.skinfoldKind') }),
        h('h2', { class: 'measure-step-title', tabindex: '-1', text: t('measure.introTitle') }),
        h('p', { class: 'field-hint', text: t('measure.introBody') }),
        createCaliperSteps(),
      ),
      { nav: navRow({ index, onNext: () => goTo(index + 1), nextLabel: t('measure.introNext'), nextIcon: 'check' }) },
    ];
  }

  function skinfoldStep(step, index) {
    const site = step.site;
    const readings = [...(draft.skinfolds[site] || [])];
    const error = h('p', { class: 'field-error', role: 'alert' });
    const mean = h('p', { class: 'measure-mean', 'aria-live': 'polite' });
    const thirdHolder = h('div');
    const spreadHint = h('p', { class: 'hint-card is-warning', role: 'note' }, icon('info'), h('span', { text: t('measure.spreadHint') }));
    const skippedHint = h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('measure.skippedNote') }));
    const isSkipped = () => (draft.skippedSkinfolds || []).includes(site);
    const skipBlock = h('div', { class: 'measure-skip-row' });
    const unskip = () => {
      if (!isSkipped()) return;
      draft.skippedSkinfolds = draft.skippedSkinfolds.filter((item) => item !== site);
      if (draft.skippedSkinfolds.length === 0) delete draft.skippedSkinfolds;
    };
    const commit = () => {
      const valid = readings.filter((value) => Number.isFinite(value));
      if (valid.length > 0) {
        draft.skinfolds[site] = valid.slice(0, MAX_READINGS);
        unskip();
      } else delete draft.skinfolds[site];
      persist();
    };
    const refresh = () => {
      const valid = readings.slice(0, 2).filter((value) => isValidSkinfold(value));
      const needThird = needsThirdReading(valid) || Number.isFinite(readings[2]);
      thirdHolder.hidden = !needThird;
      const value = siteValue(readings.filter(isValidSkinfold));
      setText(mean, value === null ? '' : t('measure.meanUsed', { value: formatMeasure(value, 'mm') }));
      spreadHint.hidden = !inconsistentReadings(readings);
      skippedHint.hidden = !isSkipped();
      skipBlock.hidden = readings.some((item) => Number.isFinite(item));
    };
    const inputs = [0, 1, 2].map((slot) =>
      bigInput({
        value: readings[slot],
        unit: t('measure.units.mm'),
        label: t('measure.reading', { number: slot + 1 }),
        onInput: (value) => {
          readings[slot] = Number.isFinite(value) ? value : undefined;
          if (slot < 2 && !needsThirdReading(readings.slice(0, 2).filter(isValidSkinfold))) readings[2] = undefined;
          setText(error, '');
          commit();
          refresh();
        },
      }),
    );
    thirdHolder.append(h('p', { class: 'field-note' }, icon('info'), h('span', { text: t('measure.thirdNeeded') })), inputs[2].element);
    refresh();
    const next = (skip) => {
      if (skip) {
        delete draft.skinfolds[site];
        goTo(index + 1);
        return;
      }
      const filled = readings.filter((value) => Number.isFinite(value));
      if (filled.some((value) => !isValidSkinfold(value))) {
        setText(error, t('measure.skinfoldInvalid', SKINFOLD_LIMITS));
        return;
      }
      if (filled.length === 0 && (step.optional || isSkipped())) {
        goTo(index + 1);
        return;
      }
      if (!isSiteComplete(filled)) {
        setText(error, filled.length < 2 ? t('measure.twoReadings') : t('measure.thirdNeeded'));
        return;
      }
      goTo(index + 1);
    };
    const name = t(`measure.sites.skinfold.${site}.name`);
    const firstFold = index === buildSteps(draft).findIndex((item) => item.type === 'skinfold');
    const askSkip = async () => {
      const height = editing && Number.isFinite(draft.heightCm) ? draft.heightCm : effectiveHeightCm(store.state);
      const body = t('measure.skipFoldBody', { site: name, girths: t(`measure.navyGirths.${draft.sex === 'female' ? 'female' : 'male'}`) });
      const confirmed = await confirmDialog({
        title: t('measure.skipFoldTitle'),
        body: Number.isFinite(height) && height > 0 ? body : `${body} ${t('measure.skipFoldHeight')}`,
        confirmLabel: t('measure.skipFoldConfirm'),
      });
      if (!confirmed) return;
      delete draft.skinfolds[site];
      draft.skippedSkinfolds = [...new Set([...(draft.skippedSkinfolds || []), site])];
      goTo(index + 1);
    };
    const tipKey = `measure.sites.skinfold.${site}.tip`;
    if (!step.optional) skipBlock.append(pressable(h('button', { type: 'button', class: 'button button-ghost button-small measure-skip-fold', text: t('measure.skipFold'), onClick: askSkip })), h('span', { class: 'field-hint', text: t('measure.skipFoldHint') }));
    return [
      h(
        'section',
        { class: 'card stack measure-step' },
        h('p', { class: 'view-eyebrow', text: step.optional ? t('measure.skinfoldOptional') : t('measure.skinfoldKind') }),
        h('div', { class: 'measure-title-row' }, h('h2', { class: 'measure-step-title', tabindex: '-1', text: name }), h('span', { class: 'pill fold-chip', text: t(`measure.fold.${FOLD_DIRECTIONS[site]}`) })),
        siteGuide('skinfold', site, { compact: true, sex: draft.sex }),
        hasKey(tipKey) ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t(tipKey) })) : null,
        step.optional ? null : skipBlock,
        skippedHint,
        h('div', { class: 'grid-2 measure-readings' }, inputs[0].element, inputs[1].element),
        thirdHolder,
        mean,
        spreadHint,
        error,
        h('details', { class: 'measure-grip', open: firstFold }, h('summary', { class: 'measure-grip-summary', text: t('measure.gripTitle') }), createPinchDiagram(site)),
      ),
      { nav: navRow({ index, onNext: next, optional: step.optional }) },
    ];
  }

  function girthStep(step, index) {
    const site = step.site;
    const limits = GIRTH_LIMITS[site];
    const error = h('p', { class: 'field-error', role: 'alert' });
    let value = draft.girths[site];
    const input = bigInput({
      value,
      unit: t('measure.units.cm'),
      label: t('measure.girthValue'),
      onInput: (next) => {
        value = next;
        if (isValidGirth(site, next)) draft.girths[site] = Math.round(next * 10) / 10;
        else delete draft.girths[site];
        setText(error, '');
        persist();
      },
    });
    const next = (skip) => {
      if (skip || value === null || value === undefined) {
        delete draft.girths[site];
        goTo(index + 1);
        return;
      }
      if (!isValidGirth(site, value)) {
        setText(error, t('measure.girthInvalid', limits));
        return;
      }
      goTo(index + 1);
    };
    const name = t(`measure.sites.girth.${site}.name`);
    const guide = siteGuide('girth', site, { compact: true, sex: draft.sex });
    if (site === 'waist') {
      const how = guide.querySelector('.site-how');
      if (how) how.textContent = t(`measure.sites.girth.waist.${draft.waistSite}`);
    }
    return [
      h(
        'section',
        { class: 'card stack measure-step' },
        h('p', { class: 'view-eyebrow', text: t('measure.girthKind') }),
        h('h2', { class: 'measure-step-title', tabindex: '-1', text: name }),
        guide,
        site === GIRTH_SITES[0] ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('measure.tapeTip') })) : null,
        step.navy ? h('p', { class: 'hint-card is-warning', role: 'note' }, icon('info'), h('span', { text: t('measure.navyNeeded') })) : null,
        input.element,
        error,
      ),
      { nav: navRow({ index, onNext: next, optional: true }) },
    ];
  }

  function resultRow(label, value, unit, decimals, status, reference) {
    return h(
      'li',
      { class: 'result-row' },
      h('span', { class: 'result-label', text: label }),
      h('span', { class: 'result-value', text: formatMeasure(value, unit, decimals) }),
      statusPill(status),
      reference ? h('span', { class: 'result-ref', text: reference }) : null,
    );
  }

  function resultsStep(index) {
    const state = store.state;
    const now = new Date();
    const session = sessionFromDraft(state, draft, now);
    const result = sessionResults(session);
    const context = { sex: session.sex, age: session.age };
    const error = h('p', { class: 'field-error', role: 'alert' });
    const rows = [];
    for (const row of RESULT_ROWS) {
      const value = result[row.id];
      if (!Number.isFinite(value)) continue;
      const decimals = row.decimals || 1;
      const reference = row.reference ? referenceFor(row.reference, context) : null;
      let label = t(`measure.results.${row.id}`);
      if (row.id === 'fatPct') label = t(`measure.results.fatBy.${result.fatSource}`);
      rows.push(resultRow(label, value, row.unit, decimals, row.reference ? classify(row.reference, value, context) : null, referenceText(reference, row.unit, decimals)));
    }
    if (result.fatSource !== 'navy' && Number.isFinite(result.navy)) {
      rows.push(resultRow(t('measure.results.fatBy.navy'), result.navy, 'pct', 1, classify('fat', result.navy, context), t('measure.results.navyHint')));
    }
    if (Number.isFinite(session.girths.waist)) {
      const reference = referenceFor('waist', context);
      rows.push(resultRow(t('measure.results.waist'), session.girths.waist, 'cm', 1, classify('waist', session.girths.waist, context), referenceText(reference, 'cm')));
    }
    const notes = [];
    const other = result.protocol === 'jp7' ? 'jp3' : result.protocol === 'jp3' ? 'jp7' : null;
    if (other && Number.isFinite(result.fatPct)) {
      const sameMonth = state.measurements.sessions
        .filter((item) => item.id !== session.id && item.protocol === other && monthKeyOf(item.at) === monthKeyOf(session.at))
        .sort((left, right) => right.at - left.at)[0];
      if (sameMonth) {
        const otherFat = sessionResults(sameMonth)[other];
        if (Number.isFinite(otherFat)) notes.push(t('measure.results.otherProtocol', { protocol: t(`measure.protocols.${other}`), value: formatMeasure(otherFat, 'pct'), diff: formatDelta(result.fatPct - otherFat, 'points') }));
      }
    }
    if (!Number.isFinite(result.weightKg)) notes.push(t('measure.results.noWeight'));
    const fallback = fallbackNote(result);
    const warning = result.outsideJpAge && result.fatSource !== 'navy' ? t('measure.results.ageNote') : null;
    if (result.muscleKg === null && result.protocol !== 'tape') notes.push(t('measure.results.muscleHint'));
    const save = (event) => {
      if (saving) return;
      saving = true;
      const button = event && event.currentTarget;
      if (button) button.disabled = true;
      clearTimeout(saveTimer);
      dirty = false;
      const outcome = measureActions.saveSession(draft);
      if (!outcome.ok) {
        saving = false;
        if (button) button.disabled = false;
        setText(error, t(`measure.saveError.${outcome.reason}`));
        return;
      }
      location.hash = '#/report';
    };
    return [
      h(
        'section',
        { class: 'card stack measure-step' },
        h('h2', { class: 'measure-step-title', tabindex: '-1', text: t('measure.resultsTitle') }),
        fallback ? h('p', { class: 'hint-card is-warning', role: 'note' }, icon('info'), h('span', { text: fallback })) : null,
        warning ? h('p', { class: 'hint-card is-warning', role: 'note' }, icon('info'), h('span', { text: warning })) : null,
        rows.length ? h('ul', { class: 'result-list is-staggered' }, rows) : h('p', { class: 'empty-note', text: t('measure.results.empty') }),
        notes.map((note) => h('p', { class: 'field-note' }, icon('info'), h('span', { text: note }))),
        h('p', { class: 'disclaimer', text: t('measure.disclaimer') }),
        error,
      ),
      {
        nav: h(
          'div',
          { class: 'measure-nav' },
          pressable(h('button', { type: 'button', class: 'button button-ghost', onClick: () => goTo(index - 1) }, icon('chevronLeft'), t('measure.prev'))),
          pressable(h('button', { type: 'button', class: 'button button-primary measure-save', onClick: save }, icon('check'), editing ? t('measure.saveEdit') : t('measure.save'))),
        ),
      },
    ];
  }

  function renderMissing() {
    clear(stepHolder);
    clear(navHolder);
    progressText.textContent = '';
    restart.hidden = true;
    stepHolder.append(h('section', { class: 'card stack' }, h('h2', { class: 'card-title', text: t('measure.editMissingTitle') }), h('p', { class: 'field-hint', text: t('measure.editMissingBody') }), h('a', { class: 'button button-primary pressable', href: '#/report' }, t('report.title'))));
  }

  function render(focus = false) {
    if (!draft) {
      renderMissing();
      return;
    }
    const steps = buildSteps(draft);
    const index = Math.max(0, Math.min(steps.length - 1, draft.step));
    draft.step = index;
    const step = steps[index];
    restart.hidden = !(resumed || editing || index > 0);
    let content;
    if (step.type === 'setup') content = setupStep(steps, index);
    else if (step.type === 'caliperIntro') content = caliperIntroStep(index);
    else if (step.type === 'skinfold') content = skinfoldStep(step, index);
    else if (step.type === 'girth') content = girthStep(step, index);
    else content = resultsStep(index);
    const items = content.flat().filter(Boolean);
    const nav = items.find((item) => item && item.nav);
    clear(stepHolder);
    clear(navHolder);
    const direction = lastIndex === -1 || index === lastIndex ? null : index > lastIndex ? 'is-forward' : 'is-back';
    const wrapper = h('div', { class: ['measure-step-wrap', direction] }, items.filter((item) => !(item && item.nav)));
    stepHolder.append(wrapper);
    if (nav) navHolder.append(nav.nav);
    updateProgress(steps, index);
    lastIndex = index;
    if (focus) {
      window.scrollTo(0, 0);
      const target = stepHolder.querySelector('.measure-input') || stepHolder.querySelector('.measure-step-title');
      if (target) target.focus({ preventScroll: true });
    }
  }

  return {
    element,
    mounted() {
      document.documentElement.classList.add('is-measuring');
      render();
    },
    tick() {},
    refresh(reason) {
      if (reason === 'reset' || reason === 'external') {
        const current = store.state.measurements[slot];
        draft = current ? cloneDraft(current) : editing ? null : newDraft(store.state, new Date());
        render();
      }
    },
    destroy() {
      document.documentElement.classList.remove('is-measuring');
      if (!saving) flush();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
