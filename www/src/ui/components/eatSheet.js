import { t } from '../../i18n/index.js';
import { lastMealTimestamp } from '../../core/fasting.js';
import { eatingChoices, proposalSignature } from '../../core/meals.js';
import { minutesToTime } from '../../core/time.js';
import { clear, h, icon, pressable } from '../dom.js';
import { openOverlay } from '../feedback.js';
import { segmented } from '../forms.js';

let active = null;

function optionButton({ title, description, recommended, onClick, iconName }) {
  return pressable(
    h(
      'button',
      { type: 'button', class: ['sheet-option', recommended ? 'is-recommended' : null], onClick },
      h('span', { class: 'sheet-option-icon', 'aria-hidden': 'true' }, icon(iconName)),
      h('span', { class: 'sheet-option-text' }, h('span', { class: 'sheet-option-title', text: title }), h('span', { class: 'sheet-option-desc', text: description })),
      recommended ? h('span', { class: 'pill sheet-option-badge', text: t('eatSheet.suggested') }) : null,
    ),
  );
}

function proposalLines(prepared, nameOf) {
  const result = prepared.full;
  const lines = [];
  if (result.kind === 'advance') {
    const start = prepared.context.plan.window.start + result.dayLog.windowShift;
    lines.push(t('eatSheet.windowLine', { time: minutesToTime(start) }));
  }
  for (const item of result.adjustments) {
    lines.push(t('eatSheet.moveLine', { name: nameOf(item.id, item.name), from: minutesToTime(item.from), to: minutesToTime(item.to) }));
  }
  for (const item of result.skipped) lines.push(t('eatSheet.skipLine', { name: nameOf(item.id, item.name) }));
  return lines;
}

export function openEatSheet({ store, actions, mealId = null, preferSnack = false }) {
  if (active) return;
  let preparedUpfront = mealId ? actions.prepareMeal(mealId) : null;
  if (preparedUpfront && (!preparedUpfront.full.ok || !preparedUpfront.changes)) {
    const outcome = actions.applyMeal(mealId, 'full', proposalSignature(preparedUpfront.full));
    if (!outcome.changed) return;
    preparedUpfront = outcome.prepared;
  }
  const titleId = 'eat-sheet-title';
  const title = h('h2', { class: 'dialog-title', id: titleId });
  const subtitle = h('p', { class: 'dialog-body' });
  const body = h('div', { class: 'sheet-body' });
  let overlay = null;
  let portion = 'normal';
  const close = () => overlay.close(false);
  const nameOf = (id, fallback) => actions.mealName(id, actions.mealContext().plan) || fallback;

  function confirmWith(selectedMealId, signature) {
    const outcome = actions.applyMeal(selectedMealId, 'full', signature, portion);
    if (outcome.changed) {
      showProposal(selectedMealId, outcome.prepared, true);
      return;
    }
    close();
  }

  function showProposal(selectedMealId, preparedBefore, updated = false) {
    const prepared = preparedBefore || actions.prepareMeal(selectedMealId);
    const signature = proposalSignature(prepared.full);
    if (!prepared.full.ok || !prepared.changes) {
      confirmWith(selectedMealId, signature);
      return;
    }
    title.textContent = t('eatSheet.proposalTitle', { name: nameOf(selectedMealId) });
    subtitle.textContent = updated ? t('eatSheet.proposalUpdated') : t('eatSheet.proposalBody');
    clear(body);
    body.append(
      ...[
      h('ul', { class: 'proposal-list' }, proposalLines(prepared, nameOf).map((line) => h('li', { class: 'proposal-line', text: line }))),
      h(
        'div',
        { class: 'dialog-actions' },
        pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('eatSheet.keep'), onClick: () => { actions.applyMeal(selectedMealId, 'keep', undefined, portion); close(); } })),
        pressable(h('button', { type: 'button', class: 'button button-primary', 'data-autofocus': true, text: t('eatSheet.confirm'), onClick: () => confirmWith(selectedMealId, signature) })),
      ),
      ].filter(Boolean),
    );
  }

  function showChoices() {
    const context = actions.mealContext();
    const state = store.state;
    const now = new Date();
    const { choices, recommendedMealId, recentMinutes } = eatingChoices({
      meals: state.meals,
      plan: context.plan,
      dayLog: store.dayLog(context.key),
      minute: context.minute,
      toleranceMinutes: state.fasting.toleranceMinutes,
      now,
      lastEatingAt: lastMealTimestamp(state.days, now.getTime()),
      minGapMinutes: state.fasting.minGapMinutes,
    });
    const snackRecommended = preferSnack || recommendedMealId === null;
    title.textContent = t('eatSheet.title');
    subtitle.textContent = t('eatSheet.subtitle');
    clear(body);
    body.append(
      ...[
      recentMinutes !== null ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('eatSheet.recentWarning', { minutes: recentMinutes }) })) : null,
      h('p', { class: 'field-label', text: t('eatSheet.portionLabel') }),
      segmented({
        label: t('eatSheet.portionLabel'),
        options: ['less', 'normal', 'more'].map((value) => ({ value, label: t(`eatSheet.portions.${value}`) })),
        value: portion,
        onChange: (value) => {
          portion = value;
        },
      }),
      h(
        'div',
        { class: 'sheet-options' },
        optionButton({
          title: t('eatSheet.snack'),
          description: t('eatSheet.snackDesc'),
          recommended: snackRecommended,
          iconName: 'flame',
          onClick: () => {
            actions.snackNow(portion);
            close();
          },
        }),
        choices.map((choice) =>
          optionButton({
            title: choice.kind === 'advance' ? t('eatSheet.advance', { name: nameOf(choice.mealId, choice.name) }) : t('eatSheet.meal', { name: nameOf(choice.mealId, choice.name) }),
            description: t('eatSheet.plannedAt', { time: minutesToTime(choice.scheduledMinutes) }),
            recommended: !snackRecommended && choice.mealId === recommendedMealId,
            iconName: 'fork',
            onClick: () => showProposal(choice.mealId),
          }),
        ),
      ),
      choices.length === 0 ? h('p', { class: 'field-hint', text: t('eatSheet.noMeals') }) : null,
      h('div', { class: 'dialog-actions' }, pressable(h('button', { type: 'button', class: 'button button-ghost', text: t('common.cancel'), onClick: close }))),
      ].filter(Boolean),
    );
  }

  overlay = openOverlay({
    className: 'sheet-panel',
    variant: 'sheet',
    labelledBy: titleId,
    content: [h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }), title, subtitle, body],
    onClose: () => {
      active = null;
    },
  });
  active = overlay;
  if (preparedUpfront) showProposal(mealId, preparedUpfront);
  else showChoices();
}
