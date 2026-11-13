import { t } from '../i18n/index.js';
import { ageOn, createBodyEntryId } from '../core/body.js';
import { optionalSkinfoldSites, protocolSites, sessionResults } from '../core/bodyComposition.js';
import { MAX_BP_READINGS, averageReadings, readingsPeak, sameBloodPressure } from '../core/bloodPressure.js';
import { effectiveHeightCm } from '../core/energy.js';
import { addIgnoredFat } from '../core/healthMerge.js';
import { monthKeyOf } from '../core/measurementReport.js';
import { showToast } from './feedback.js';

const DRAFT_REASON = 'measureDraft';
const FRESH_WEIGHT_DAYS = 3;
const DOUBLE_SAVE_MS = 2500;

export function freshWeight(state, now) {
  const limit = now.getTime() - FRESH_WEIGHT_DAYS * 86400000;
  const recent = state.body.weights.filter((entry) => entry.at >= limit && entry.at <= now.getTime() + 60000);
  if (recent.length === 0) return null;
  return recent.reduce((latest, entry) => (entry.at > latest.at ? entry : latest), recent[0]);
}

export function newDraft(state, now) {
  const sex = state.profile.sex === 'female' || state.profile.sex === 'male' ? state.profile.sex : null;
  return {
    protocol: 'jp7',
    sex,
    step: 0,
    weightKg: null,
    waistSite: state.measurements.waistSite,
    skinfolds: {},
    girths: {},
    editingId: null,
    editingAt: null,
    updatedAt: now.getTime(),
  };
}

export function editDraftFor(session, now) {
  return {
    protocol: session.protocol,
    sex: session.sex,
    age: session.age,
    heightCm: session.heightCm,
    step: 0,
    weightKg: session.weightKg,
    waistSite: session.waistSite,
    skinfolds: JSON.parse(JSON.stringify(session.skinfolds)),
    girths: { ...session.girths },
    editingId: session.id,
    editingAt: session.at,
    updatedAt: now.getTime(),
  };
}

export function sessionFromDraft(state, draft, now) {
  const editing = Boolean(draft.editingId) && Number.isFinite(draft.editingAt);
  const at = editing ? draft.editingAt : now.getTime();
  const fresh = freshWeight(state, new Date(at));
  const sites = [...protocolSites(draft.protocol, draft.sex), ...optionalSkinfoldSites(draft.protocol, draft.sex)];
  const skinfolds = {};
  for (const site of sites) if (draft.skinfolds[site]) skinfolds[site] = [...draft.skinfolds[site]];
  let weightKg = Number.isFinite(draft.weightKg) ? draft.weightKg : null;
  if (weightKg === null && !editing && fresh) weightKg = fresh.kg;
  return {
    id: draft.editingId || createBodyEntryId('ms', at),
    at,
    protocol: draft.protocol,
    sex: draft.sex,
    age: editing && Number.isFinite(draft.age) ? draft.age : ageOn(state.profile, new Date(at)),
    weightKg,
    heightCm: editing && Number.isFinite(draft.heightCm) ? draft.heightCm : effectiveHeightCm(state),
    waistSite: draft.waistSite,
    skinfolds,
    girths: { ...draft.girths },
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createMeasureActions(store, bodyActions, { toast = showToast } = {}) {
  let lastSave = { key: '', at: 0 };

  function replaceMeasurements(changes, reason = 'measure') {
    const state = store.state;
    store.replace({ ...state, measurements: { ...state.measurements, ...changes } }, reason);
  }

  function fatEntryFor(session) {
    const result = sessionResults(session);
    if (result.fatSource !== 'jp3' && result.fatSource !== 'jp7') return null;
    return { id: createBodyEntryId('bf', session.at), at: session.at, pct: result.fatPct, source: 'manual', sessionId: session.id };
  }

  function ignoreFat(body, entry) {
    if (!entry) return body;
    if (entry.healthWritten || store.state.health.writeBodyFat) return addIgnoredFat(body, entry);
    return body;
  }

  function fatStillThere(entry) {
    return store.state.body.fat.some((item) => item.id === entry.id && item.pct === entry.pct);
  }

  async function writeFat(entry) {
    if (!entry || !store.state.health.writeBodyFat || !fatStillThere(entry)) return;
    const iso = new Date(entry.at).toISOString();
    const saved = await bodyActions.saveHealthSample('writeBodyFat', { dataType: 'bodyFat', value: entry.pct / 100, unit: 'percent', startDate: iso, endDate: iso });
    if (!saved) return;
    const state = store.state;
    if (!fatStillThere(entry)) {
      store.replace({ ...state, body: addIgnoredFat(state.body, entry) }, 'measure');
      return;
    }
    store.replace({ ...state, body: { ...state.body, fat: state.body.fat.map((item) => (item.id === entry.id ? { ...item, healthWritten: true } : item)) } }, 'measure');
  }

  function pressureIgnore(entry) {
    return { at: entry.at, systolic: entry.systolic, diastolic: entry.diastolic };
  }

  async function writePressure(entry) {
    if (!store.state.health.writeBloodPressure) return;
    const iso = new Date(entry.at).toISOString();
    const saved = await bodyActions.saveHealthSample('writeBloodPressure', { dataType: 'bloodPressure', value: entry.systolic, systolic: entry.systolic, diastolic: entry.diastolic, unit: 'mmHg', startDate: iso, endDate: iso });
    if (!saved) return;
    const measurements = store.state.measurements;
    if (!measurements.bloodPressure.some((item) => item.id === entry.id)) {
      replaceMeasurements({ ignoredHealthPressure: [...measurements.ignoredHealthPressure, pressureIgnore(entry)] });
      return;
    }
    replaceMeasurements({ bloodPressure: measurements.bloodPressure.map((item) => (item.id === entry.id ? { ...item, healthWritten: true } : item)) });
  }

  function putSession(session, fatEntry) {
    const state = store.state;
    const previousFat = state.body.fat.find((item) => item.sessionId === session.id) || null;
    let body = { ...state.body, fat: state.body.fat.filter((item) => item.sessionId !== session.id) };
    let saved = fatEntry;
    if (previousFat && fatEntry && previousFat.pct === fatEntry.pct) saved = { ...fatEntry, id: previousFat.id, ...(previousFat.healthWritten ? { healthWritten: true } : {}) };
    else if (previousFat) body = ignoreFat(body, previousFat);
    if (saved) body = { ...body, fat: [...body.fat, saved] };
    const slot = session.id && state.measurements.editDraft && state.measurements.editDraft.editingId === session.id ? { editDraft: null } : { draft: null };
    store.replace({ ...state, body, measurements: { ...state.measurements, ...slot, sessions: [...state.measurements.sessions.filter((item) => item.id !== session.id), session], waistSite: session.waistSite } }, 'measure');
    return saved;
  }

  function removeSession(id) {
    const state = store.state;
    const session = state.measurements.sessions.find((item) => item.id === id);
    if (!session) return null;
    const fatEntry = state.body.fat.find((item) => item.sessionId === id) || null;
    const body = ignoreFat({ ...state.body, fat: state.body.fat.filter((item) => item.sessionId !== id) }, fatEntry);
    const editDraft = state.measurements.editDraft && state.measurements.editDraft.editingId === id ? null : state.measurements.editDraft;
    store.replace({ ...state, body, measurements: { ...state.measurements, editDraft, sessions: state.measurements.sessions.filter((item) => item.id !== id) } }, 'measure');
    return { session, fatEntry };
  }

  function restoreSession(removed) {
    const state = store.state;
    if (state.measurements.sessions.some((item) => item.id === removed.session.id)) return false;
    const fatEntry = removed.fatEntry ? { ...removed.fatEntry, id: createBodyEntryId('bf', removed.fatEntry.at), healthWritten: false } : null;
    const fat = fatEntry ? [...state.body.fat.filter((item) => item.sessionId !== removed.session.id), fatEntry] : state.body.fat;
    store.replace({ ...state, body: { ...state.body, fat }, measurements: { ...state.measurements, sessions: [...state.measurements.sessions, removed.session] } }, 'measure');
    if (fatEntry) writeFat(fatEntry);
    return true;
  }

  function staleUndo() {
    toast(t('toast.undoStale'));
  }

  function logTypedWeight(draft, session) {
    if (draft.editingId || !Number.isFinite(draft.weightKg)) return;
    bodyActions.addWeight(draft.weightKg, { at: session.at, confirmed: true });
  }

  function deletePressure(id, { silent = false } = {}) {
    const state = store.state;
    const removed = state.measurements.bloodPressure.find((item) => item.id === id);
    if (!removed) return;
    const ignore = removed.source === 'health' || removed.healthWritten || state.health.writeBloodPressure;
    replaceMeasurements({
      bloodPressure: state.measurements.bloodPressure.filter((item) => item.id !== id),
      ignoredHealthPressure: ignore ? [...state.measurements.ignoredHealthPressure, pressureIgnore(removed)] : state.measurements.ignoredHealthPressure,
    });
    if (silent) return;
    toast(t('toast.pressureDeleted'), {
      action: {
        label: t('common.undo'),
        onClick: () => {
          const current = store.state.measurements;
          if (current.bloodPressure.some((item) => item.id === removed.id)) return;
          replaceMeasurements({
            bloodPressure: [...current.bloodPressure, removed],
            ignoredHealthPressure: removed.source === 'health' ? current.ignoredHealthPressure.filter((item) => !sameBloodPressure(item, removed, 0)) : current.ignoredHealthPressure,
          });
        },
      },
    });
  }

  return {
    saveDraft(draft) {
      const slot = draft.editingId ? 'editDraft' : 'draft';
      replaceMeasurements({ [slot]: { ...draft, updatedAt: Date.now() } }, DRAFT_REASON);
    },
    clearDraft(editing = false) {
      replaceMeasurements({ [editing ? 'editDraft' : 'draft']: null }, DRAFT_REASON);
    },
    pendingEditFor(id) {
      const editDraft = store.state.measurements.editDraft;
      return Boolean(editDraft && editDraft.editingId !== id);
    },
    startEdit(id) {
      const state = store.state;
      const session = state.measurements.sessions.find((item) => item.id === id);
      if (!session) return false;
      if (state.measurements.editDraft && state.measurements.editDraft.editingId === id) return true;
      replaceMeasurements({ editDraft: editDraftFor(session, new Date()) }, DRAFT_REASON);
      return true;
    },
    saveSession(draft) {
      const state = store.state;
      if (draft.sex !== 'female' && draft.sex !== 'male') return { ok: false, reason: 'sex' };
      if (draft.editingId && !state.measurements.sessions.some((item) => item.id === draft.editingId)) return { ok: false, reason: 'gone' };
      const key = JSON.stringify({ ...draft, updatedAt: 0, step: 0 });
      if (lastSave.key === key && Date.now() - lastSave.at < DOUBLE_SAVE_MS) return { ok: true, duplicate: true };
      const session = sessionFromDraft(state, draft, new Date());
      if (Object.keys(session.skinfolds).length === 0 && Object.keys(session.girths).length === 0) return { ok: false, reason: 'empty' };
      lastSave = { key, at: Date.now() };
      const previousSession = state.measurements.sessions.find((item) => item.id === session.id) || null;
      const previousFat = state.body.fat.find((item) => item.sessionId === session.id) || null;
      const saved = putSession(session, fatEntryFor(session));
      if (saved && !saved.healthWritten) writeFat(saved);
      logTypedWeight(draft, session);
      toast(t(previousSession ? 'toast.measureUpdated' : 'toast.measureSaved'), {
        tone: 'success',
        action: {
          label: t('common.undo'),
          onClick: () => {
            const current = store.state.measurements.sessions.find((item) => item.id === session.id);
            if (!current || !sameJson(current, session)) {
              staleUndo();
              return;
            }
            removeSession(session.id);
            if (previousSession) restoreSession({ session: previousSession, fatEntry: previousFat });
          },
        },
      });
      return { ok: true, session };
    },
    deleteSession(id) {
      const removed = removeSession(id);
      if (!removed) return;
      toast(t('toast.measureDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            if (!restoreSession(removed)) staleUndo();
          },
        },
      });
    },
    addPressure({ readings, arm }) {
      const average = averageReadings(readings);
      if (!average) return { ok: false };
      const peak = readingsPeak(readings);
      const at = Date.now();
      const entry = {
        id: createBodyEntryId('bp', at),
        at,
        systolic: average.systolic,
        diastolic: average.diastolic,
        pulse: average.pulse,
        arm,
        count: Math.min(MAX_BP_READINGS, average.count),
        source: 'manual',
        ...(peak && average.count > 1 ? { peakSystolic: peak.systolic, peakDiastolic: peak.diastolic } : {}),
      };
      const state = store.state;
      replaceMeasurements({ bloodPressure: [...state.measurements.bloodPressure, entry], lastArm: arm || state.measurements.lastArm });
      const stored = store.state.measurements.bloodPressure.find((item) => item.id === entry.id);
      if (!stored) return { ok: false };
      toast(t('toast.pressureSaved', { value: `${entry.systolic}/${entry.diastolic}` }), {
        tone: 'success',
        action: { label: t('common.undo'), onClick: () => deletePressure(entry.id, { silent: true }) },
      });
      writePressure(entry);
      return { ok: true, entry: stored };
    },
    deletePressure,
    setReminder(changes) {
      replaceMeasurements({ reminder: { ...store.state.measurements.reminder, ...changes } }, 'settings');
    },
    dismissReminder(now = new Date()) {
      replaceMeasurements({ reminder: { ...store.state.measurements.reminder, dismissedMonth: monthKeyOf(now.getTime()) } });
    },
    setSex(sex) {
      bodyActions.updateProfile({ sex });
    },
  };
}
