import { sessionResults } from './bodyComposition.js';
import { classify, referenceFor } from './bodyReferences.js';
import { pad2 } from './time.js';

export const REPORT_ROWS = [
  { id: 'fatJp7', unit: 'pct', decimals: 1, reference: 'fat', pick: (result) => result.jp7 },
  { id: 'fatJp3', unit: 'pct', decimals: 1, reference: 'fat', pick: (result) => result.jp3 },
  { id: 'fatDiff', unit: 'points', decimals: 1 },
  { id: 'fatNavy', unit: 'pct', decimals: 1, reference: 'fat', pick: (result) => result.navy },
  { id: 'fatMass', unit: 'kg', decimals: 1, pick: (result) => result.fatMassKg },
  { id: 'leanMass', unit: 'kg', decimals: 1, pick: (result) => result.leanMassKg },
  { id: 'muscle', unit: 'kg', decimals: 1, pick: (result) => result.muscleKg },
  { id: 'ffmi', unit: 'index', decimals: 1, reference: 'ffmi', pick: (result) => result.ffmi },
  { id: 'bmi', unit: 'index', decimals: 1, reference: 'bmi', pick: (result) => result.bmi },
  { id: 'weight', unit: 'kg', decimals: 1, pick: (result) => result.weightKg },
  { id: 'waist', unit: 'cm', decimals: 1, reference: 'waist', pick: (result) => result.girths.waist },
  { id: 'whr', unit: 'ratio', decimals: 2, reference: 'whr', pick: (result) => result.whr },
  { id: 'whtr', unit: 'ratio', decimals: 2, reference: 'whtr', pick: (result) => result.whtr },
  { id: 'neck', unit: 'cm', decimals: 1, pick: (result) => result.girths.neck },
  { id: 'chest', unit: 'cm', decimals: 1, pick: (result) => result.girths.chest },
  { id: 'hip', unit: 'cm', decimals: 1, pick: (result) => result.girths.hip },
  { id: 'armRelaxed', unit: 'cm', decimals: 1, pick: (result) => result.girths.armRelaxed },
  { id: 'armFlexed', unit: 'cm', decimals: 1, pick: (result) => result.girths.armFlexed },
  { id: 'forearm', unit: 'cm', decimals: 1, pick: (result) => result.girths.forearm },
  { id: 'thigh', unit: 'cm', decimals: 1, pick: (result) => result.girths.thigh },
  { id: 'calf', unit: 'cm', decimals: 1, pick: (result) => result.girths.calf },
  { id: 'systolic', unit: 'mmHg', decimals: 0, reference: 'systolic', bp: 'systolic' },
  { id: 'diastolic', unit: 'mmHg', decimals: 0, reference: 'diastolic', bp: 'diastolic' },
  { id: 'pulse', unit: 'bpm', decimals: 0, bp: 'pulse' },
];

export function monthKeyOf(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function isValidMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function sessionCompleteness(session) {
  return Object.keys(session.skinfolds || {}).length + Object.keys(session.girths || {}).length + (Number.isFinite(session.weightKg) ? 1 : 0);
}

export function primarySession(list) {
  return list.reduce((best, session) => (!best || sessionCompleteness(session) >= sessionCompleteness(best) ? session : best), null);
}

function latestOfProtocol(list, protocol) {
  const matching = list.filter((session) => session.protocol === protocol);
  return matching.length ? matching[matching.length - 1] : null;
}

export function monthlySessionValues(sessions) {
  const groups = new Map();
  for (const session of [...(sessions || [])].sort((left, right) => left.at - right.at)) {
    const month = monthKeyOf(session.at);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(session);
  }
  const byMonth = new Map();
  for (const [month, list] of groups) {
    const primary = primarySession(list);
    const result = sessionResults(primary);
    const context = (session) => ({ sex: session.sex, age: session.age, sessionId: session.id });
    const values = {};
    for (const row of REPORT_ROWS) {
      if (!row.pick || row.id === 'fatJp7' || row.id === 'fatJp3') continue;
      const value = finite(row.pick(result));
      if (value !== null) values[row.id] = { value, context: context(primary) };
    }
    for (const [rowId, protocol] of [['fatJp7', 'jp7'], ['fatJp3', 'jp3']]) {
      const session = primary.protocol === protocol ? primary : latestOfProtocol(list, protocol);
      const value = session ? finite(sessionResults(session)[protocol]) : null;
      if (value !== null) values[rowId] = { value, context: context(session) };
    }
    if (values.fatJp7 && values.fatJp3) values.fatDiff = { value: Math.round((values.fatJp7.value - values.fatJp3.value) * 10) / 10, context: values.fatJp7.context };
    byMonth.set(month, values);
  }
  return byMonth;
}

export function monthlyPressure(entries) {
  const groups = new Map();
  for (const entry of entries || []) {
    const month = monthKeyOf(entry.at);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(entry);
  }
  const result = new Map();
  for (const [month, list] of groups) {
    const mean = (values) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
    const pulses = list.map((entry) => entry.pulse).filter((value) => Number.isFinite(value));
    result.set(month, { systolic: mean(list.map((entry) => entry.systolic)), diastolic: mean(list.map((entry) => entry.diastolic)), pulse: mean(pulses), count: list.length });
  }
  return result;
}

export function buildMeasurementReport({ sessions, bloodPressure, sex, age }, monthsLimit = 6) {
  const sessionMonths = monthlySessionValues(sessions);
  const pressureMonths = monthlyPressure(bloodPressure);
  const allMonths = [...new Set([...sessionMonths.keys(), ...pressureMonths.keys()])].sort();
  const months = allMonths.slice(-Math.max(1, monthsLimit));
  const rows = [];
  for (const row of REPORT_ROWS) {
    const series = allMonths.map((month) => {
      if (row.bp) {
        const pressure = pressureMonths.get(month);
        return { month, value: pressure ? finite(pressure[row.bp]) : null, context: { sex, age } };
      }
      const item = (sessionMonths.get(month) || {})[row.id];
      return { month, value: item ? item.value : null, context: item ? item.context : { sex, age } };
    });
    let previous = null;
    const cells = series.map((item) => {
      const delta = item.value !== null && previous !== null ? Math.round((item.value - previous.value) * 10 ** row.decimals) / 10 ** row.decimals : null;
      const deltaFrom = delta !== null ? previous.month : null;
      if (item.value !== null) previous = item;
      return { month: item.month, value: item.value, delta, deltaFrom, context: item.context, status: row.reference ? classify(row.reference, item.value, item.context) : null };
    });
    const visible = cells.filter((cell) => months.includes(cell.month));
    const filled = visible.filter((cell) => cell.value !== null);
    if (filled.length === 0) continue;
    const latestContext = filled[filled.length - 1].context;
    rows.push({
      id: row.id,
      unit: row.unit,
      decimals: row.decimals,
      referenceId: row.reference || null,
      reference: row.reference ? referenceFor(row.reference, latestContext) : null,
      cells: visible,
    });
  }
  return { months, rows };
}

export function latestSessionValue(report, rowId) {
  const row = report.rows.find((item) => item.id === rowId);
  if (!row) return null;
  const cells = row.cells.filter((cell) => cell.value !== null);
  return cells.length ? cells[cells.length - 1] : null;
}


export function previousMonthKey(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}
