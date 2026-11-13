import { t } from '../i18n/index.js';
import { STORAGE_KEY, clearBackups, clearState, createDefaultState, inspectState, loadStateWithReport, sanitizeState, saveState } from '../core/storage.js';
import { emptyDayLog, cloneDayLog } from '../core/meals.js';
import { showToast } from './feedback.js';

function defaultMealNames() {
  return {
    breakfast: t('meals.defaults.breakfast'),
    lunch: t('meals.defaults.lunch'),
    snack: t('meals.defaults.snack'),
    dinner: t('meals.defaults.dinner'),
  };
}

function safeStorage() {
  try {
    const storage = window.localStorage;
    return storage || null;
  } catch {
    return null;
  }
}

export function createStore() {
  const storage = safeStorage();
  const defaults = () => createDefaultState(new Date(), defaultMealNames());
  const report = storage ? loadStateWithReport(storage, defaults(), new Date()) : { state: defaults(), backupKey: null };
  let state = report.state;
  let warnedSaveFailure = false;
  const listeners = new Set();

  function persist() {
    const saved = storage ? saveState(storage, state) : false;
    if (!saved && !warnedSaveFailure) {
      warnedSaveFailure = true;
      showToast(t('toast.saveFailed'), { tone: 'warning', duration: null });
    }
  }

  function notify(reason) {
    for (const listener of listeners) listener(state, reason);
  }

  if (report.backupKey) setTimeout(() => showToast(t('toast.backupKept'), { tone: 'warning', duration: null }), 0);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (!storage) return;
    let raw = null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    const inspected = inspectState(raw);
    if (inspected.status === 'ok') state = sanitizeState(inspected.parsed, defaults(), new Date());
    else if (inspected.status === 'empty') state = defaults();
    else return;
    notify('external');
  });

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(next, reason = 'update') {
      state = sanitizeState(next, defaults(), new Date());
      persist();
      notify(reason);
    },
    dayLog(key) {
      return state.days[key] ? cloneDayLog(state.days[key]) : emptyDayLog();
    },
    setDayLog(key, dayLog, reason = 'day') {
      this.replace({ ...state, days: { ...state.days, [key]: dayLog } }, reason);
    },
    reset() {
      if (storage) clearState(storage);
      state = defaults();
      notify('reset');
    },
    clearBackups() {
      return storage ? clearBackups(storage) : false;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}
