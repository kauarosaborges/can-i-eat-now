import { t } from '../../i18n/index.js';
import { isValidDayWake, plannedNight } from '../../core/sleep.js';
import { MS_PER_HOUR, MS_PER_MINUTE, addDaysToKey, dateAtMinutes, isValidTime, minutesToTime, timeToMinutes } from '../../core/time.js';
import { h, icon, pressable, setText } from '../dom.js';
import { openOverlay } from '../feedback.js';
import { formatDateShort } from '../format.js';

let sheetCounter = 0;

function timeValue(ms) {
  const date = new Date(ms);
  return minutesToTime(date.getHours() * 60 + date.getMinutes());
}

export function defaultNightTimes(profile, wakeKey, nowMs) {
  const night = plannedNight(profile, wakeKey);
  if (night.wakeAt <= nowMs) return { sleptAt: night.sleepAt, wokeAt: night.wakeAt };
  const wokeAt = Math.floor(nowMs / (5 * MS_PER_MINUTE)) * 5 * MS_PER_MINUTE;
  return { sleptAt: Math.min(night.sleepAt, wokeAt - MS_PER_HOUR), wokeAt };
}

export function sleepTimesFromInputs(wakeKey, sleptText, wokeText) {
  if (!sleptText || !wokeText) return { ok: false, reason: 'missingTime' };
  if (!isValidTime(sleptText) || !isValidTime(wokeText)) return { ok: false, reason: 'invalid' };
  const wokeMinute = timeToMinutes(wokeText);
  const sleptMinute = timeToMinutes(sleptText);
  const wokeAt = dateAtMinutes(wakeKey, wokeMinute).getTime();
  const sleptKey = sleptMinute > wokeMinute ? addDaysToKey(wakeKey, -1) : wakeKey;
  const sleptAt = dateAtMinutes(sleptKey, sleptMinute).getTime();
  return { ok: true, sleptAt, wokeAt };
}

export function validateSleepTimes(profile, wakeKey, times, nowMs) {
  if (!times.ok) return times.reason || 'invalid';
  if (times.wokeAt <= times.sleptAt || times.wokeAt > nowMs + 5 * MS_PER_MINUTE || times.wokeAt - times.sleptAt > 20 * MS_PER_HOUR) return 'invalid';
  if (!isValidDayWake(profile, wakeKey, times.wokeAt)) return 'invalidWake';
  return null;
}

export function openSleepEntrySheet({ store, sleepActions, wakeKey, initial, onDelete }) {
  sheetCounter += 1;
  const titleId = `sleep-entry-title-${sheetCounter}`;
  const start = initial || defaultNightTimes(store.state.profile, wakeKey, Date.now());
  const sleptInput = h('input', { class: 'input', type: 'time', value: timeValue(start.sleptAt), 'aria-label': t('sleepCard.slept'), 'data-autofocus': true });
  const wokeInput = h('input', { class: 'input', type: 'time', value: timeValue(start.wokeAt), 'aria-label': t('sleepCard.woke') });
  const error = h('p', { class: 'field-error', role: 'alert' });
  let overlay = null;
  const save = () => {
    const times = sleepTimesFromInputs(wakeKey, sleptInput.value, wokeInput.value);
    const problem = validateSleepTimes(store.state.profile, wakeKey, times, Date.now());
    if (problem) {
      setText(error, t(`sleepCard.${problem}`));
      return;
    }
    sleepActions.confirmSleep(times.sleptAt, times.wokeAt, wakeKey);
    overlay.close(true);
  };
  overlay = openOverlay({
    className: 'sheet-panel',
    variant: 'sheet',
    labelledBy: titleId,
    content: [
      h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      h('h2', { class: 'dialog-title', id: titleId, text: t('sleep.editTitle', { date: formatDateShort(wakeKey) }) }),
      h(
        'div',
        { class: 'sheet-body' },
        h(
          'div',
          { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('sleepCard.slept') }), sleptInput),
          h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('sleepCard.woke') }), wokeInput),
        ),
        error,
        onDelete
          ? pressable(
              h(
                'button',
                {
                  type: 'button',
                  class: 'button button-ghost sheet-delete',
                  onClick: () => {
                    overlay.close(false);
                    onDelete();
                  },
                },
                icon('trash'),
                t('sleep.deleteNight'),
              ),
            )
          : null,
      ),
      h(
        'div',
        { class: 'dialog-actions' },
        pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('common.cancel'), onClick: () => overlay.close(false) })),
        pressable(h('button', { type: 'button', class: 'button button-primary', text: t('sleepCard.save'), onClick: save })),
      ),
    ],
  });
  return overlay;
}
