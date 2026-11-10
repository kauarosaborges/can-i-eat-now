import { dayContext, fastState, lastMealTimestamp } from './fasting.js';
import { buildTimeline, nextMeal } from './meals.js';
import { MS_PER_MINUTE, dateAtMinutes } from './time.js';

export function eatingVerdict(state, now) {
  const nowMs = now.getTime();
  const fast = fastState(state, now);
  const lastEatingAt = lastMealTimestamp(state.days, nowMs);
  const gapMs = state.fasting.minGapMinutes * MS_PER_MINUTE;
  const context = dayContext(state.fasting, state.days, now);
  const timeline = buildTimeline(state.meals, context.plan, state.days[context.key], context.minute, state.fasting.toleranceMinutes);
  const upcoming = nextMeal(timeline);
  const nextMealAt = upcoming ? dateAtMinutes(context.key, upcoming.scheduledMinutes).getTime() : null;
  const base = { fast, lastEatingAt, nextMeal: upcoming, nextMealAt, context };
  if (lastEatingAt !== null && nowMs - lastEatingAt < gapMs) {
    const gapEnd = lastEatingAt + gapMs;
    let availableAt = gapEnd;
    if (fast.phase !== 'eating') availableAt = fast.targetEnd === null ? null : Math.max(gapEnd, fast.targetEnd);
    else if (gapEnd >= fast.windowEnd) availableAt = null;
    return { ...base, canEat: false, reason: 'recentlyAte', minutesSince: Math.floor((nowMs - lastEatingAt) / MS_PER_MINUTE), availableAt };
  }
  if (fast.phase !== 'eating') return { ...base, canEat: false, reason: 'fasting', availableAt: fast.targetEnd };
  return { ...base, canEat: true, reason: 'window', availableAt: null };
}
