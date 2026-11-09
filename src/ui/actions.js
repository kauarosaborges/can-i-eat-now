import { t } from '../i18n/index.js';
import { MODIFIED_MEAL_ID, classifyDay, dayContext } from '../core/fasting.js';
import { addWaterEntry, computeDailyGoal, createWaterEntryId, hydrationDayContext, removeWaterEntry, totalWaterMl } from '../core/hydration.js';
import { eatMealNow, skipMeal as skipMealInLog, undoEatMeal, undoSkipMeal } from '../core/meals.js';
import { LIMITS } from '../core/storage.js';
import { clampInteger } from '../core/time.js';
import { showToast } from './feedback.js';
import { formatMl, formatTimeOfDay } from './format.js';

export function haptic() {
  try {
    if (navigator.vibrate) navigator.vibrate(8);
  } catch {
    return;
  }
}

export function createActions(store) {
  function mealName(mealId, plan) {
    if (mealId === MODIFIED_MEAL_ID) return t('meal.modifiedName', { kcal: plan && plan.modifiedMeal ? plan.modifiedMeal.kcal : store.state.fasting.alternate.modifiedMealKcal });
    const meal = store.state.meals.find((item) => item.id === mealId);
    return meal ? meal.name : '';
  }

  function undoAction(key, reverse) {
    return {
      label: t('common.undo'),
      onClick: () => {
        const result = reverse(store.dayLog(key));
        if (!result.ok) {
          showToast(t('toast.nothingToUndo'));
          return;
        }
        store.setDayLog(key, result.dayLog, 'undo');
        showToast(t('toast.undone'));
      },
    };
  }

  function refusalMessage(result) {
    if (result.reason === 'tooEarly') return t('toast.tooEarly', { minutes: result.minutesUntilAllowed });
    const known = ['tooLate', 'fastingDay', 'modifiedUsed', 'alreadyDone', 'unknownMeal'];
    return t(`toast.${known.includes(result.reason) ? result.reason : 'tooLate'}`);
  }

  function mealContext() {
    const state = store.state;
    return dayContext(state.fasting, state.days, new Date());
  }

  return {
    mealName,
    mealContext,
    eatMeal(mealId) {
      const now = new Date();
      const state = store.state;
      const context = dayContext(state.fasting, state.days, now);
      const result = eatMealNow({
        meals: state.meals,
        plan: context.plan,
        dayLog: store.dayLog(context.key),
        mealId,
        now,
        minute: context.minute,
        toleranceMinutes: state.fasting.toleranceMinutes,
        minGapMinutes: state.fasting.minGapMinutes,
      });
      if (!result.ok) {
        showToast(refusalMessage(result), { tone: 'warning' });
        return false;
      }
      haptic();
      store.setDayLog(context.key, result.dayLog, 'meal');
      const name = mealName(mealId, context.plan);
      showToast(t('toast.mealLogged', { name, time: formatTimeOfDay(result.dayLog.meals[mealId].minute) }), {
        tone: 'success',
        action: undoAction(context.key, (log) => undoEatMeal(log, result.undo)),
      });
      const notes = [];
      if (result.kind === 'advance') notes.push(t('toast.advanced', { minutes: result.advanceMinutes }));
      if (result.kind === 'late') notes.push(t('toast.late', { minutes: result.lateMinutes }));
      for (const item of result.adjustments) notes.push(t('toast.adjusted', { name: item.name, time: formatTimeOfDay(item.to) }));
      for (const item of result.skipped) notes.push(t('toast.skippedNoFit', { name: item.name }));
      if (notes.length > 0) showToast(notes.join(' '), { tone: result.kind === 'inside' ? 'info' : 'warning' });
      return true;
    },
    skipMeal(mealId) {
      const context = mealContext();
      store.setDayLog(context.key, skipMealInLog(store.dayLog(context.key), mealId), 'meal');
      haptic();
      showToast(t('toast.mealSkipped', { name: mealName(mealId, classifyDay(store.state.fasting, context.key)) }), {
        action: undoAction(context.key, (log) => undoSkipMeal(log, mealId)),
      });
    },
    addWater(ml) {
      const amount = clampInteger(ml, LIMITS.customWaterMl.min, LIMITS.customWaterMl.max, 250);
      const now = new Date();
      const context = hydrationDayContext(store.state.profile, now);
      const previous = store.dayLog(context.key);
      const entry = { id: createWaterEntryId(now.getTime()), at: now.getTime(), ml: amount };
      const next = addWaterEntry(previous, entry);
      const goal = computeDailyGoal(store.state.profile).goalMl;
      const crossed = totalWaterMl(previous.water) < goal && totalWaterMl(next.water) >= goal;
      store.setDayLog(context.key, next, 'water');
      haptic();
      showToast(crossed ? t('toast.goalReached') : t('toast.waterAdded', { ml: formatMl(amount) }), {
        tone: 'water',
        action: undoAction(context.key, (log) => removeWaterEntry(log, entry.id)),
      });
      return amount;
    },
    undoWater() {
      const context = hydrationDayContext(store.state.profile, new Date());
      const log = store.dayLog(context.key);
      const last = log.water[log.water.length - 1];
      if (!last) {
        showToast(t('toast.nothingToUndo'));
        return false;
      }
      store.setDayLog(context.key, removeWaterEntry(log, last.id).dayLog, 'water');
      haptic();
      showToast(t('toast.waterUndone'));
      return true;
    },
  };
}
