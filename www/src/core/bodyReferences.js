export const STATUSES = ['good', 'borderline', 'out'];

const FAT_TABLE = {
  female: [
    { maxAge: 39, low: 21, high: 33, over: 39 },
    { maxAge: 59, low: 23, high: 34, over: 40 },
    { maxAge: Infinity, low: 24, high: 36, over: 42 },
  ],
  male: [
    { maxAge: 39, low: 8, high: 20, over: 25 },
    { maxAge: 59, low: 11, high: 22, over: 28 },
    { maxAge: Infinity, low: 13, high: 25, over: 30 },
  ],
};

export const REFERENCE_SOURCES = {
  fat: 'gallagher',
  waist: 'who',
  whr: 'who',
  whtr: 'ashwell',
  bmi: 'who',
  ffmi: 'espen',
  systolic: 'sbc',
  diastolic: 'sbc',
};

function fatBands(sex, age) {
  const rows = FAT_TABLE[sex];
  if (!rows) return null;
  const row = rows.find((item) => age <= item.maxAge) || rows[rows.length - 1];
  return [
    { status: 'borderline', max: row.low },
    { status: 'good', min: row.low, max: row.high },
    { status: 'borderline', min: row.high, max: row.over },
    { status: 'out', min: row.over },
  ];
}

function bandsFor(metric, { sex, age }) {
  switch (metric) {
    case 'fat':
      return fatBands(sex, Number.isFinite(age) ? age : 30);
    case 'waist':
      if (sex === 'male') return [{ status: 'good', max: 94 }, { status: 'borderline', min: 94, max: 102 }, { status: 'out', min: 102 }];
      if (sex === 'female') return [{ status: 'good', max: 80 }, { status: 'borderline', min: 80, max: 88 }, { status: 'out', min: 88 }];
      return null;
    case 'whr':
      if (sex === 'male') return [{ status: 'good', max: 0.9 }, { status: 'out', min: 0.9 }];
      if (sex === 'female') return [{ status: 'good', max: 0.85 }, { status: 'out', min: 0.85 }];
      return null;
    case 'whtr':
      return [{ status: 'borderline', max: 0.4 }, { status: 'good', min: 0.4, max: 0.5 }, { status: 'borderline', min: 0.5, max: 0.6 }, { status: 'out', min: 0.6 }];
    case 'bmi':
      return [{ status: 'out', max: 17 }, { status: 'borderline', min: 17, max: 18.5 }, { status: 'good', min: 18.5, max: 25 }, { status: 'borderline', min: 25, max: 30 }, { status: 'out', min: 30 }];
    case 'ffmi':
      if (sex === 'male') return [{ status: 'out', max: 17 }, { status: 'borderline', min: 17, max: 18 }, { status: 'good', min: 18 }];
      if (sex === 'female') return [{ status: 'out', max: 15 }, { status: 'borderline', min: 15, max: 16 }, { status: 'good', min: 16 }];
      return null;
    case 'systolic':
      return [{ status: 'good', max: 120 }, { status: 'borderline', min: 120, max: 140 }, { status: 'out', min: 140 }];
    case 'diastolic':
      return [{ status: 'good', max: 80 }, { status: 'borderline', min: 80, max: 90 }, { status: 'out', min: 90 }];
    default:
      return null;
  }
}

export function referenceFor(metric, context = {}) {
  const bands = bandsFor(metric, context);
  if (!bands) return null;
  const good = bands.filter((band) => band.status === 'good');
  return { bands, good: good[0], source: REFERENCE_SOURCES[metric] };
}

export function classify(metric, value, context = {}) {
  if (!Number.isFinite(value)) return null;
  const bands = bandsFor(metric, context);
  if (!bands) return null;
  for (const band of bands) {
    const aboveMin = band.min === undefined || value >= band.min;
    const belowMax = band.max === undefined || value < band.max;
    if (aboveMin && belowMax) return band.status;
  }
  return null;
}

export function worstStatus(statuses) {
  let worst = null;
  for (const status of statuses) {
    if (!status) continue;
    if (worst === null || STATUSES.indexOf(status) > STATUSES.indexOf(worst)) worst = status;
  }
  return worst;
}
