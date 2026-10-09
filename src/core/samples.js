// Built-in practice datasets, generated deterministically so lessons always match the data.

import { toCSV } from './transform.js';

function rng(seed) {
  // mulberry32
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const round = (x, d = 0) => Number(x.toFixed(d));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pick = (rand, items) => items[Math.floor(rand() * items.length)];

function coffeeShop() {
  const rand = rng(42);
  const rows = [];
  const start = Date.UTC(2024, 0, 1);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let d = 0; d < 366; d++) {
    const date = new Date(start + d * 86400000);
    const weekday = days[date.getUTCDay()];
    const weekend = weekday === 'Sat' || weekday === 'Sun';
    const season = Math.sin(((d - 100) / 366) * 2 * Math.PI);
    const temp = round(14 + 11 * season + normal(rand) * 3, 1);
    const rainy = rand() < 0.25 - 0.1 * season;
    const promotion = rand() < 0.15;
    const customers = Math.round(clamp(180 + (weekend ? 70 : 0) + (promotion ? 45 : 0) - (rainy ? 30 : 0) + normal(rand) * 22, 60, 500));
    const icedShare = clamp(0.1 + (temp - 5) * 0.022, 0.03, 0.8);
    const drinks = customers * (1.1 + rand() * 0.2);
    const iced = Math.round(drinks * icedShare);
    const hot = Math.round(drinks - iced);
    const pastries = Math.round(customers * (0.35 + (weekend ? 0.12 : 0) + normal(rand) * 0.04));
    const revenue = round(hot * 3.6 + iced * 4.4 + pastries * 3.1 + normal(rand) * 25, 2);
    rows.push([
      date.toISOString().slice(0, 10),
      weekday,
      // A few days where the thermometer failed – useful for learning about missing data.
      rand() < 0.03 ? '' : temp,
      rainy ? 'yes' : 'no',
      promotion ? 'yes' : 'no',
      customers,
      hot,
      iced,
      pastries,
      revenue,
    ]);
  }
  return toCSV(['date', 'weekday', 'temperature_c', 'rainy', 'promotion', 'customers', 'hot_drinks', 'iced_drinks', 'pastries', 'revenue'], rows);
}

function students() {
  const rand = rng(7);
  const majors = ['Biology', 'Business', 'Computer Science', 'History', 'Psychology'];
  const difficulty = { Biology: -3, Business: 2, 'Computer Science': -5, History: 3, Psychology: 1 };
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const major = pick(rand, majors);
    const hours = round(clamp(6 + normal(rand) * 3, 0, 18), 1);
    const sleep = round(clamp(7 + normal(rand) * 1.1, 3.5, 10), 1);
    const attendance = Math.round(clamp(82 + normal(rand) * 11, 30, 100));
    const practice = Math.round(clamp(hours / 3 + normal(rand), 0, 8));
    let score = 32 + hours * 2.6 + attendance * 0.25 + (sleep - 7) * 2 + practice * 1.5 + difficulty[major] + normal(rand) * 6;
    // A handful of surprising results – great for spotting outliers.
    if (rand() < 0.02) score -= 35;
    score = Math.round(clamp(score, 0, 100));
    rows.push([
      `S${String(1001 + i)}`,
      major,
      hours,
      rand() < 0.04 ? '' : sleep,
      attendance,
      practice,
      score,
      score >= 60 ? 'yes' : 'no',
    ]);
  }
  return toCSV(['student_id', 'major', 'hours_studied', 'sleep_hours', 'attendance_pct', 'practice_tests', 'exam_score', 'passed'], rows);
}

export const SAMPLES = [
  {
    id: 'coffee',
    name: 'Coffee shop sales',
    emoji: '☕',
    description: 'One year of daily sales. Explore how weather, weekends and promotions affect business.',
    build: coffeeShop,
  },
  {
    id: 'students',
    name: 'Student exam results',
    emoji: '🎓',
    description: '300 students. Find out what really predicts a good exam score.',
    build: students,
  },
];

export function sampleCSV(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`Unknown sample: ${id}`);
  return sample.build();
}
