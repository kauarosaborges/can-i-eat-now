import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairDayLog } from '../www/src/core/dayRepair.js';
import { classifyDay } from '../www/src/core/fasting.js';
import { buildTimeline, eatMealNow, emptyDayLog, restoreMealTime, resetDayPlan, setManualMealTime } from '../www/src/core/meals.js';
import { createDefaultState, parseState } from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-10';

function at(time, key = DAY) {
  return localDate(key, time);
}

test('v1 state with the old 02:00 auto shift loads with lunch back at its planned time', () => {
  const now = at('10:00');
  const raw = JSON.stringify({
    version: 1,
    onboarded: true,
    fasting: { mode: 'weekdays', weekdays: { fastingDays: [0, 6] }, toleranceMinutes: 60, minGapMinutes: 150 },
    days: {
      [DAY]: {
        windowShift: 0,
        meals: { breakfast: { eatenAt: at('02:00').getTime(), minute: 120 } },
        skips: {},
        adjustments: { lunch: 360, snack: 510, dinner: 840 },
        water: [],
      },
    },
  });
  const state = parseState(raw, createDefaultState(now, MEAL_NAMES), now);
  assert.deepEqual(state.days[DAY].adjustments, { snack: 510, dinner: 840 });
  const plan = classifyDay(state.fasting, DAY);
  const timeline = buildTimeline(state.meals, plan, state.days[DAY], 600, 60);
  assert.equal(timeline.find((item) => item.id === 'lunch').scheduledMinutes, 750);
  assert.equal(state.days[DAY].meals.breakfast.minute, 120);
});

test('the meal proposal never moves following meals before wake time', () => {
  const state = makeState({ fasting: { mode: 'weekdays' } });
  const plan = classifyDay(state.fasting, DAY);
  const result = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'breakfast', now: at('02:00'), minute: 120, toleranceMinutes: 60, minGapMinutes: 150, earliestMinute: 420 });
  assert.deepEqual(result.adjustments.map((item) => [item.id, item.to]), [['lunch', 420], ['snack', 630], ['dinner', 840]]);
});

test('repair drops adjustments in sleep, before wake or beyond tolerance outside the window', () => {
  const state = makeState();
  const dayLog = { ...emptyDayLog(), adjustments: { lunch: 360, snack: 1290, dinner: 1150 }, windowShift: -150 };
  const repaired = repairDayLog(state, DAY, dayLog).dayLog;
  assert.deepEqual(repaired.adjustments, { dinner: 1150 });
  assert.equal(repaired.windowShift, 0);
  const valid = repairDayLog(state, DAY, { ...emptyDayLog(), adjustments: { snack: 900 }, windowShift: -40 }).dayLog;
  assert.deepEqual(valid.adjustments, { snack: 900 });
  assert.equal(valid.windowShift, -40);
});

test('manual times override, survive repair outside the window, but never during sleep', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, DAY);
  let dayLog = setManualMealTime({ ...emptyDayLog(), adjustments: { lunch: 700 } }, 'lunch', 1290);
  assert.equal(buildTimeline(state.meals, plan, dayLog, 600, 60).find((item) => item.id === 'lunch').scheduledMinutes, 1290);
  assert.deepEqual(repairDayLog(state, DAY, dayLog).dayLog.manualTimes, { lunch: 1290 });
  assert.deepEqual(repairDayLog(state, DAY, setManualMealTime(emptyDayLog(), 'lunch', 1400)).dayLog.manualTimes, {});
  dayLog = restoreMealTime(dayLog, 'lunch');
  assert.deepEqual(dayLog.manualTimes, {});
  assert.deepEqual(dayLog.adjustments, {});
  const reset = resetDayPlan({ ...emptyDayLog(), manualTimes: { snack: 900 }, adjustments: { dinner: 1100 }, windowShift: -30 });
  assert.deepEqual([reset.manualTimes, reset.adjustments, reset.windowShift], [{}, {}, 0]);
});

test('meals with a manual time are not shifted by a later proposal', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  const plan = classifyDay(state.fasting, DAY);
  const dayLog = setManualMealTime(emptyDayLog(), 'snack', 990);
  const result = eatMealNow({ meals: state.meals, plan, dayLog, mealId: 'lunch', now: at('11:40'), minute: 700, toleranceMinutes: 60, minGapMinutes: 150 });
  assert.ok(!result.adjustments.some((item) => item.id === 'snack'));
});
