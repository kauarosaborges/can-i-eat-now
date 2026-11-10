import { t } from '../../i18n/index.js';
import { inferSleep, shouldOfferSleepConfirm } from '../../core/sleep.js';
import { toDateKey } from '../../core/time.js';
import { clear, h, icon, pressable } from '../dom.js';
import { formatTimestamp } from '../format.js';
import { openSleepEntrySheet } from './sleepEntrySheet.js';

export function createSleepConfirmCard({ store, sleepActions }) {
  const element = h('section', { class: 'card sleep-card', hidden: true });
  let signature = '';

  function update(now, nightActive = false) {
    const state = store.state;
    const offer = !nightActive && shouldOfferSleepConfirm(state, now);
    element.hidden = !offer;
    if (!offer) {
      signature = '';
      return;
    }
    const key = toDateKey(now);
    const proposal = inferSleep(state.activity, state.profile, key, now);
    const next = `${key}:${proposal.sleptAt}:${proposal.wokeAt}`;
    if (next === signature) return;
    signature = next;
    clear(element);
    element.append(
      h('p', { class: 'sleep-question' }, icon('moon'), h('span', { text: t('sleepCard.question', { slept: formatTimestamp(proposal.sleptAt), woke: formatTimestamp(proposal.wokeAt) }) })),
      h('p', { class: 'field-hint', text: t('sleepCard.hint') }),
      h(
        'div',
        { class: 'button-row' },
        pressable(h('button', { type: 'button', class: 'button button-primary', text: t('sleepCard.confirm'), onClick: () => sleepActions.confirmSleep(proposal.sleptAt, proposal.wokeAt, key) })),
        pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('sleepCard.adjust'), onClick: () => openSleepEntrySheet({ store, sleepActions, wakeKey: key, initial: proposal }) })),
        pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('sleepCard.noSleep'), onClick: () => sleepActions.markNoSleep(key) })),
      ),
    );
  }

  return {
    element,
    update,
    reset() {
      signature = '';
    },
  };
}
