import { t } from '../i18n/index.js';
import { MODIFIED_MEAL_ID, classifyDay, dayContext } from '../core/fasting.js';
import { addWaterEntry, computeDailyGoal, createWaterEntryId, hydrationDayContext, removeWaterEntry, totalWaterMl } from '../core/hydration.js';
import { eatMealKeepSchedule, eatMealNow, logSnack, planChanges, proposalSignature, removeSnack, skipMeal as skipMealInLog, undoEatMeal, undoSkipMeal } from '../core/meals.js';
import { LIMITS } from '../core/storage.js';
import { clampInteger } from '../core/time.js';
import { showToast } from './feedback.js';
import { formatMl, formatTimeOfDay } from './format.js';
import { nativeHaptic } from './platform.js';

export function haptic(style = 'LIGHT') {
  if (nativeHaptic(style)) return;
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
    prepareMeal(mealId) {
      const now = new Date();
      const state = store.state;
      const context = dayContext(state.fasting, state.days, now);
      const input = {
        meals: state.meals,
        plan: context.plan,
        dayLog: store.dayLog(context.key),
        mealId,
        now,
        minute: context.minute,
        toleranceMinutes: state.fasting.toleranceMinutes,
        minGapMinutes: state.fasting.minGapMinutes,
      };
      const full = eatMealNow(input);
      return { mealId, context, full, keep: full.ok ? eatMealKeepSchedule(input) : full, changes: planChanges(full) };
    },
    applyMeal(mealId, variant, shownSignature) {
      const prepared = this.prepareMeal(mealId);
      const result = variant === 'keep' ? prepared.keep : prepared.full;
      if (variant !== 'keep' && shownSignature !== undefined && proposalSignature(prepared.full) !== shownSignature) {
        return { applied: false, changed: true, prepared };
      }
      if (!result.ok) {
        showToast(refusalMessage(result), { tone: 'warning' });
        return { applied: false, changed: false, prepared };
      }
      const { context } = prepared;
      haptic('MEDIUM');
      store.setDayLog(context.key, result.dayLog, 'meal');
      const name = mealName(mealId, context.plan);
      showToast(t('toast.mealLogged', { name, time: formatTimeOfDay(result.dayLog.meals[mealId].minute) }), {
        tone: 'success',
        action: undoAction(context.key, (log) => undoEatMeal(log, result.undo)),
      });
      if (variant === 'keep' && prepared.changes) showToast(t('toast.scheduleKept'), { tone: 'info' });
      if (variant !== 'keep' && result.kind === 'late') showToast(t('toast.late', { minutes: result.lateMinutes }), { tone: 'warning' });
      return { applied: true, changed: false, prepared };
    },
    snackNow() {
      const now = new Date();
      const context = mealContext();
      const { dayLog, snack } = logSnack(store.dayLog(context.key), now, context.minute);
      haptic('MEDIUM');
      store.setDayLog(context.key, dayLog, 'meal');
      showToast(t('toast.snackLogged', { time: formatTimeOfDay(snack.minute) }), {
        tone: 'success',
        action: undoAction(context.key, (log) => removeSnack(log, snack.id)),
      });
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
