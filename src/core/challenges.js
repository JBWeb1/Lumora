// Practice challenges: short questions about the practice datasets. The right answer is
// worked out from the data itself, so it always matches what the person sees.

import { mean } from './stats.js';

const col = (ds, name) => ds.columns.find((c) => c.name === name);
const rows = (ds) => [...Array(ds.rowCount).keys()];
const sumBy = (ds, by, value) => {
  const out = new Map();
  for (const i of rows(ds)) {
    const k = col(ds, by).raw[i];
    out.set(k, (out.get(k) ?? 0) + (value ? col(ds, value).values[i] ?? 0 : 1));
  }
  return out;
};
const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0][0];

export const CHALLENGES = [
  {
    id: 'coffee-best-day', sample: 'coffee', level: 'Starter',
    question: 'Which day of the week brings in the most revenue in total?',
    kind: 'choice', options: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    answer: (ds) => top(sumBy(ds, 'weekday', 'revenue')),
    hint: 'Summarize: group rows by weekday and calculate the sum of revenue. Or Analyses → “What makes up most of the total?”',
  },
  {
    id: 'coffee-rainy-days', sample: 'coffee', level: 'Starter',
    question: 'On how many days did it rain?',
    kind: 'number', tolerance: 0,
    answer: (ds) => col(ds, 'rainy').values.filter((v) => v === true).length,
    hint: 'Add a filter “rainy is yes” and read the row count, or look at the rainy column card on the Overview.',
  },
  {
    id: 'coffee-rain-customers', sample: 'coffee', level: 'Explorer',
    question: 'On rainy days, are there more or fewer customers on average, and is the difference real?',
    kind: 'choice', options: () => ['More, and it’s real', 'Fewer, and it’s real', 'No real difference'],
    answer: (ds) => {
      const rain = col(ds, 'rainy').values;
      const c = col(ds, 'customers').values;
      const wet = mean(rows(ds).filter((i) => rain[i] === true && c[i] != null).map((i) => c[i]));
      const dry = mean(rows(ds).filter((i) => rain[i] === false && c[i] != null).map((i) => c[i]));
      if (Math.abs(wet - dry) / dry < 0.03) return 'No real difference';
      return wet > dry ? 'More, and it’s real' : 'Fewer, and it’s real';
    },
    hint: 'Analyses → “How do two groups differ?”, split by rainy. Look at customers and the “real or luck?” verdict.',
  },
  {
    id: 'coffee-driver', sample: 'coffee', level: 'Explorer',
    question: 'Apart from revenue itself, which column is most closely related to iced drinks sold?',
    kind: 'choice', options: () => ['temperature_c', 'rainy', 'promotion', 'weekday'],
    answer: () => 'temperature_c',
    hint: 'Analyses → “What affects a number?” and choose iced_drinks.',
  },
  {
    id: 'students-pass-rate', sample: 'students', level: 'Starter',
    question: 'What percentage of students passed? (round to the nearest whole number)',
    kind: 'number', tolerance: 1,
    answer: (ds) => Math.round((col(ds, 'passed').values.filter((v) => v === true).length / ds.rowCount) * 100),
    hint: 'The Overview card for “passed” shows the share of yes and no.',
  },
  {
    id: 'students-study', sample: 'students', level: 'Explorer',
    question: 'What is the average exam score of students who studied more than 10 hours? (to the nearest whole number)',
    kind: 'number', tolerance: 1,
    answer: (ds) => {
      const h = col(ds, 'hours_studied').values;
      const s = col(ds, 'exam_score').values;
      return Math.round(mean(rows(ds).filter((i) => h[i] > 10 && s[i] != null).map((i) => s[i])));
    },
    hint: 'Add a filter “hours_studied > 10”, then look at exam_score on the Overview or in Summarize (average).',
  },
  {
    id: 'students-groups', sample: 'students', level: 'Analyst',
    question: 'Which major has the highest median exam score?',
    kind: 'choice', options: (ds) => [...new Set(col(ds, 'major').values.filter(Boolean))].sort(),
    answer: (ds) => {
      const by = new Map();
      for (const i of rows(ds)) {
        const m = col(ds, 'major').values[i];
        const v = col(ds, 'exam_score').values[i];
        if (m == null || v == null) continue;
        if (!by.has(m)) by.set(m, []);
        by.get(m).push(v);
      }
      const median = (xs) => {
        const s = [...xs].sort((a, b) => a - b);
        return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      };
      return [...by.entries()].sort((a, b) => median(b[1]) - median(a[1]))[0][0];
    },
    hint: 'Chart builder: X = major, Y = exam_score, chart type Box plot. The line in each box is the median.',
  },
];

/** Check an answer. Returns { correct, answer }. */
export function checkChallenge(challenge, ds, given) {
  const answer = challenge.answer(ds);
  if (challenge.kind === 'number') {
    const n = Number(String(given).replace(/[%,\s]/g, ''));
    return { correct: Number.isFinite(n) && Math.abs(n - answer) <= (challenge.tolerance ?? 0), answer };
  }
  return { correct: String(given) === String(answer), answer };
}
