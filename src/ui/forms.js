import { t } from '../i18n/index.js';
import { INTERMITTENT_PRESETS, classifyDay, presetEatingHours } from '../core/fasting.js';
import { ACTIVITY_LEVELS, computeDailyGoal } from '../core/hydration.js';
import { MAX_MEALS, sanitizeMealName, MAX_MEAL_NAME_LENGTH, mealsOutsideWindow } from '../core/meals.js';
import { LIMITS, SEXES, createMealId, resolveNotificationsEnabled } from '../core/storage.js';
import { clampNumber, isValidDateKey, minutesToTime, sanitizeTime, timeToMinutes, toDateKey } from '../core/time.js';
import { clear, h, icon, pressable, setText } from './dom.js';
import { showToast } from './feedback.js';
import { formatMl } from './format.js';
import { permissionState, requestPermission, shouldShowIosHint } from './notifications.js';

let fieldCounter = 0;

function nextId(prefix) {
  fieldCounter += 1;
  return `${prefix}-${fieldCounter}`;
}

export function field(labelText, control, hintText) {
  const id = control.id || nextId('field');
  control.id = id;
  const hintId = hintText ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: id, text: labelText }),
    control,
    hintText ? h('p', { class: 'field-hint', id: hintId, text: hintText }) : null,
  );
}

export function numberInput({ value, limits, step = 1, onCommit }) {
  const input = h('input', {
    class: 'input',
    type: 'number',
    inputmode: step < 1 ? 'decimal' : 'numeric',
    min: limits.min,
    max: limits.max,
    step,
    value,
  });
  input.addEventListener('change', () => {
    const previous = Number(input.dataset.previous || value);
    const clamped = clampNumber(input.value, limits.min, limits.max, previous);
    const rounded = step < 1 ? Math.round(clamped * 10) / 10 : Math.round(clamped);
    input.value = String(rounded);
    input.dataset.previous = String(rounded);
    onCommit(rounded);
  });
  return input;
}

export function timeInput({ value, onCommit }) {
  const input = h('input', { class: 'input', type: 'time', value, step: 300 });
  input.addEventListener('change', () => {
    const next = sanitizeTime(input.value, input.dataset.previous || value);
    input.value = next;
    input.dataset.previous = next;
    onCommit(next);
  });
  return input;
}

export function segmented({ options, value, onChange, label }) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label || null });
  const buttons = options.map((option) =>
    pressable(
      h('button', {
        type: 'button',
        class: 'segment',
        role: 'radio',
        'aria-checked': String(option.value === value),
        text: option.label,
        onClick: () => {
          for (const button of buttons) button.setAttribute('aria-checked', String(button === buttons[options.indexOf(option)]));
          onChange(option.value);
        },
      }),
    ),
  );
  group.append(...buttons);
  return group;
}

export function toggle({ checked, label, hint, onChange, disabled }) {
  const input = h('input', { type: 'checkbox', class: 'switch-input', checked: checked || null, role: 'switch', disabled: disabled || null });
  input.addEventListener('change', () => onChange(input.checked));
  return h(
    'label',
    { class: 'switch-row' },
    h('span', { class: 'switch-text' }, h('span', { class: 'switch-label', text: label }), hint ? h('span', { class: 'field-hint', text: hint }) : null),
    input,
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
  );
}

function selectInput({ options, value, onChange }) {
  const select = h('select', { class: 'input' }, options.map((option) => h('option', { value: option.value, selected: option.value === value || null, text: option.label })));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

const MODE_ICONS = { intermittent: 'today', weekdays: 'history', alternate: 'flame' };

export function modePicker(draft, commit) {
  const cards = [];
  const container = h('div', { class: 'mode-cards', role: 'radiogroup', 'aria-label': t('settings.modeSection') });
  for (const mode of ['intermittent', 'weekdays', 'alternate']) {
    const card = pressable(
      h(
        'button',
        {
          type: 'button',
          class: 'mode-card',
          role: 'radio',
          'aria-checked': String(draft.fasting.mode === mode),
          onClick: () => {
            draft.fasting.mode = mode;
            for (const item of cards) item.setAttribute('aria-checked', String(item === card));
            commit('mode');
          },
        },
        h('span', { class: 'mode-card-icon' }, icon(MODE_ICONS[mode])),
        h('span', { class: 'mode-card-text' }, h('span', { class: 'mode-card-title', text: t(`mode.${mode}`) }), h('span', { class: 'mode-card-desc', text: t(`mode.${mode}Desc`) })),
        h('span', { class: 'mode-card-check' }, icon('check')),
      ),
    );
    cards.push(card);
    container.append(card);
  }
  return container;
}

function intermittentDetails(draft, commit) {
  const settings = draft.fasting.intermittent;
  const endNote = h('p', { class: 'field-note' });
  const customHolder = h('div');
  const refreshEnd = () => {
    const hours = presetEatingHours(settings.preset, settings.eatingHours);
    const end = timeToMinutes(settings.windowStart) + hours * 60;
    setText(endNote, end > 1440 ? t('mode.windowEndNextDay', { time: minutesToTime(end) }) : t('mode.windowEnd', { time: minutesToTime(end) }));
  };
  const renderCustom = () => {
    clear(customHolder);
    if (settings.preset !== 'custom') return;
    customHolder.append(
      field(
        t('mode.eatingHours'),
        numberInput({
          value: settings.eatingHours,
          limits: LIMITS.eatingHours,
          onCommit: (value) => {
            settings.eatingHours = value;
            refreshEnd();
            commit('fasting');
          },
        }),
      ),
    );
  };
  renderCustom();
  refreshEnd();
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'field-label', text: t('mode.preset') }),
    segmented({
      label: t('mode.preset'),
      options: INTERMITTENT_PRESETS.map((preset) => ({ value: preset.id, label: t(`mode.presets.${preset.id}`) })),
      value: settings.preset,
      onChange: (value) => {
        settings.preset = value;
        renderCustom();
        refreshEnd();
        commit('fasting');
      },
    }),
    customHolder,
    field(
      t('mode.windowStart'),
      timeInput({
        value: settings.windowStart,
        onCommit: (value) => {
          settings.windowStart = value;
          refreshEnd();
          commit('fasting');
        },
      }),
    ),
    endNote,
  );
}

function weekdaysDetails(draft, commit) {
  const settings = draft.fasting.weekdays;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const buttons = order.map((day) => {
    const button = pressable(
      h('button', {
        type: 'button',
        class: 'day-toggle',
        'aria-pressed': String(settings.fastingDays.includes(day)),
        'aria-label': t(`days.long.${day}`),
        text: t(`days.short.${day}`),
        onClick: () => {
          const active = settings.fastingDays.includes(day);
          if (active && settings.fastingDays.length === 1) return;
          if (!active && settings.fastingDays.length >= 6) return;
          settings.fastingDays = active ? settings.fastingDays.filter((item) => item !== day) : [...settings.fastingDays, day].sort();
          button.setAttribute('aria-pressed', String(!active));
          commit('fasting');
        },
      }),
    );
    return button;
  });
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'field-label', text: t('mode.fastingDays') }),
    h('div', { class: 'day-toggles' }, buttons),
    h('p', { class: 'field-hint', text: t('mode.fastingDaysHint') }),
  );
}

function alternateDetails(draft, commit) {
  const settings = draft.fasting.alternate;
  const todayNote = h('p', { class: 'field-note' });
  const modifiedHolder = h('div', { class: 'stack' });
  const refreshToday = () => {
    const plan = classifyDay(draft.fasting, toDateKey(new Date()));
    setText(todayNote, plan.isFastingDay ? t('mode.todayFasting') : t('mode.todayEating'));
  };
  const renderModified = () => {
    clear(modifiedHolder);
    modifiedHolder.append(h('p', { class: 'field-hint', text: settings.fastingDayType === 'zero' ? t('mode.zeroDesc') : t('mode.modifiedDesc') }));
    if (settings.fastingDayType !== 'modified') return;
    modifiedHolder.append(
      field(t('mode.modifiedTime'), timeInput({ value: settings.modifiedMealTime, onCommit: (value) => { settings.modifiedMealTime = value; commit('fasting'); } })),
      field(t('mode.modifiedKcal'), numberInput({ value: settings.modifiedMealKcal, limits: LIMITS.modifiedMealKcal, step: 10, onCommit: (value) => { settings.modifiedMealKcal = value; commit('fasting'); } })),
    );
  };
  const dateInput = h('input', { class: 'input', type: 'date', value: settings.cycleStart });
  dateInput.addEventListener('change', () => {
    if (isValidDateKey(dateInput.value)) settings.cycleStart = dateInput.value;
    dateInput.value = settings.cycleStart;
    refreshToday();
    commit('fasting');
  });
  renderModified();
  refreshToday();
  return h(
    'div',
    { class: 'stack' },
    field(t('mode.cycleStart'), dateInput),
    todayNote,
    h('p', { class: 'field-label', text: t('mode.fastingDayType') }),
    segmented({
      label: t('mode.fastingDayType'),
      options: [
        { value: 'zero', label: t('mode.zero') },
        { value: 'modified', label: t('mode.modified') },
      ],
      value: settings.fastingDayType,
      onChange: (value) => {
        settings.fastingDayType = value;
        renderModified();
        commit('fasting');
      },
    }),
    modifiedHolder,
  );
}

export function modeDetails(draft, commit) {
  const holder = h('div', { class: 'mode-details' });
  const render = () => {
    clear(holder);
    const builders = { intermittent: intermittentDetails, weekdays: weekdaysDetails, alternate: alternateDetails };
    holder.append(builders[draft.fasting.mode](draft, commit));
  };
  render();
  return { element: holder, render };
}

export function mealsEditor(draft, commit) {
  const list = h('div', { class: 'meal-editor' });
  const warnings = new Map();
  const refreshWarnings = () => {
    const outside = new Set(mealsOutsideWindow(draft.meals, draft.fasting, toDateKey(new Date())));
    for (const [id, element] of warnings) setText(element, outside.has(id) ? t('meals.outsideWindow') : '');
  };
  const render = () => {
    clear(list);
    warnings.clear();
    draft.meals.forEach((meal) => {
      const nameInput = h('input', { class: 'input', type: 'text', value: meal.name, maxlength: MAX_MEAL_NAME_LENGTH * 2, autocomplete: 'off', 'aria-label': t('meals.name') });
      nameInput.addEventListener('change', () => {
        meal.name = sanitizeMealName(nameInput.value, meal.name);
        nameInput.value = meal.name;
        commit('meals');
      });
      const time = timeInput({
        value: meal.time,
        onCommit: (value) => {
          meal.time = value;
          draft.meals.sort((left, right) => timeToMinutes(left.time) - timeToMinutes(right.time));
          commit('meals');
          render();
          const inputs = list.querySelectorAll('input[type="time"]');
          const index = draft.meals.indexOf(meal);
          if (inputs[index]) inputs[index].focus();
        },
      });
      time.setAttribute('aria-label', t('meals.time'));
      const remove = pressable(
        h(
          'button',
          {
            type: 'button',
            class: 'icon-button',
            'aria-label': t('meals.remove', { name: meal.name }),
            onClick: () => {
              if (draft.meals.length <= 1) {
                showToast(t('meals.minOne'));
                return;
              }
              draft.meals = draft.meals.filter((item) => item.id !== meal.id);
              commit('meals');
              render();
            },
          },
          icon('trash'),
        ),
      );
      const warning = h('p', { class: 'field-warning', role: 'status' });
      warnings.set(meal.id, warning);
      list.append(h('div', { class: 'meal-editor-row' }, nameInput, time, remove), warning);
    });
    const add = pressable(
      h(
        'button',
        {
          type: 'button',
          class: 'button button-soft',
          disabled: draft.meals.length >= MAX_MEALS || null,
          onClick: () => {
            if (draft.meals.length >= MAX_MEALS) {
              showToast(t('meals.max', { count: MAX_MEALS }));
              return;
            }
            const last = draft.meals[draft.meals.length - 1];
            const time = last ? minutesToTime(Math.min(1380, timeToMinutes(last.time) + 120)) : '12:00';
            draft.meals.push({ id: createMealId(), name: t('meals.newName'), time });
            commit('meals');
            render();
            const inputs = list.querySelectorAll('input[type="text"]');
            if (inputs.length) inputs[inputs.length - 1].select();
          },
        },
        icon('plus'),
        t('meals.add'),
      ),
    );
    list.append(add);
    refreshWarnings();
  };
  render();
  return { element: list, render, refreshWarnings };
}

export function flexFields(draft, commit) {
  return h(
    'div',
    { class: 'grid-2' },
    field(t('settings.tolerance'), numberInput({ value: draft.fasting.toleranceMinutes, limits: LIMITS.toleranceMinutes, step: 5, onCommit: (value) => { draft.fasting.toleranceMinutes = value; commit('flex'); } }), t('settings.toleranceHint')),
    field(t('settings.minGap'), numberInput({ value: draft.fasting.minGapMinutes, limits: LIMITS.minGapMinutes, step: 5, onCommit: (value) => { draft.fasting.minGapMinutes = value; commit('flex'); } }), t('settings.minGapHint')),
  );
}

export function profileFields(draft, commit) {
  const profile = draft.profile;
  const preview = h('p', { class: 'goal-preview' });
  const refresh = () => setText(preview, t('profile.goalPreview', { amount: formatMl(computeDailyGoal(profile).goalMl) }));
  const update = (key) => (value) => {
    profile[key] = value;
    refresh();
    commit('profile');
  };
  refresh();
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid-3' },
      field(t('profile.weight'), numberInput({ value: profile.weightKg, limits: LIMITS.weightKg, step: 0.1, onCommit: update('weightKg') })),
      field(t('profile.height'), numberInput({ value: profile.heightCm, limits: LIMITS.heightCm, onCommit: update('heightCm') })),
      field(t('profile.age'), numberInput({ value: profile.age, limits: LIMITS.age, onCommit: update('age') })),
    ),
    field(t('profile.sex'), selectInput({ options: SEXES.map((sex) => ({ value: sex, label: t(`profile.sexes.${sex}`) })), value: profile.sex, onChange: update('sex') })),
    h('p', { class: 'field-label', text: t('profile.activity') }),
    segmented({ label: t('profile.activity'), options: ACTIVITY_LEVELS.map((level) => ({ value: level, label: t(`profile.activities.${level}`) })), value: profile.activity, onChange: update('activity') }),
    h(
      'div',
      { class: 'grid-2' },
      field(t('profile.exercise'), numberInput({ value: profile.exerciseMinutes, limits: LIMITS.exerciseMinutes, step: 5, onCommit: update('exerciseMinutes') })),
      field(t('profile.glass'), numberInput({ value: profile.glassMl, limits: LIMITS.glassMl, step: 10, onCommit: update('glassMl') })),
      field(t('profile.wake'), timeInput({ value: profile.wakeTime, onCommit: update('wakeTime') })),
      field(t('profile.sleep'), timeInput({ value: profile.sleepTime, onCommit: update('sleepTime') })),
    ),
    toggle({ checked: profile.hotClimate, label: t('profile.hotClimate'), hint: t('profile.hotClimateHint'), onChange: update('hotClimate') }),
    preview,
  );
}

export function notificationControl(draft, commit) {
  const status = h('p', { class: 'field-note' });
  let switchInput = null;
  const refresh = () => {
    const permission = permissionState();
    setText(status, t(`notifications.status.${permission}`));
    if (switchInput) {
      switchInput.checked = resolveNotificationsEnabled(draft.notifications.enabled, permission);
      switchInput.disabled = permission === 'unsupported' || permission === 'denied';
    }
  };
  const control = toggle({
    checked: resolveNotificationsEnabled(draft.notifications.enabled, permissionState()),
    label: t('notifications.toggle'),
    hint: t('notifications.toggleHint'),
    onChange: async (wanted) => {
      let permission = permissionState();
      if (wanted && permission === 'default') permission = await requestPermission();
      draft.notifications.enabled = resolveNotificationsEnabled(wanted, permission);
      commit('notifications');
      refresh();
      if (!wanted) return;
      if (permission === 'granted') showToast(t('toast.notificationsOn'), { tone: 'success' });
      else if (permission === 'unsupported') showToast(t('toast.notificationsUnsupported'));
      else showToast(t('toast.notificationsDenied'));
    },
  });
  switchInput = control.querySelector('input');
  refresh();
  return h(
    'div',
    { class: 'stack' },
    control,
    status,
    h('p', { class: 'field-hint', text: t('notifications.inApp') }),
    shouldShowIosHint() ? h('p', { class: 'hint-card' }, icon('info'), h('span', { text: t('water.iosHint') })) : null,
  );
}
