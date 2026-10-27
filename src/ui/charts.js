// SVG chart rendering. Colours come from CSS classes so charts follow the light/dark theme.

import { el, svg } from './dom.js';
import { niceTicks } from '../core/stats.js';
import { formatDate, formatNumber } from '../core/transform.js';

const W = 720;
const H = 380;
const DAY = 86400000;

const scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function frame(width, height, label, children) {
  return svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': label }, children);
}

function timeTicks(lo, hi) {
  const days = (hi - lo) / DAY;
  const d = new Date(lo);
  const ticks = [];
  if (days > 365 * 3) {
    const step = Math.ceil(days / 365 / 7);
    for (let y = d.getUTCFullYear(); ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > hi) break;
      if (t >= lo) ticks.push(t);
    }
    return { ticks, fmt: (t) => String(new Date(t).getUTCFullYear()) };
  }
  if (days > 75) {
    const step = Math.max(1, Math.ceil(days / 30 / 7));
    for (let m = d.getUTCMonth() + d.getUTCFullYear() * 12; ; m += step) {
      const t = Date.UTC(Math.floor(m / 12), m % 12, 1);
      if (t > hi) break;
      if (t >= lo) ticks.push(t);
    }
    return { ticks, fmt: (t) => formatDate(t).replace(/ \d+,/, '') };
  }
  const step = Math.max(1, Math.ceil(days / 7));
  for (let t = Math.ceil(lo / DAY) * DAY; t <= hi; t += step * DAY) ticks.push(t);
  return { ticks, fmt: (t) => formatDate(t).replace(/, \d{4}$/, '') };
}

function yAxis(ticks, y, left, right, fmt = formatNumber) {
  return ticks.map((t) => [
    svg('line', { class: 'grid', x1: left, x2: right, y1: y(t), y2: y(t) }),
    svg('text', { class: 'tick', x: left - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, fmt(t)),
  ]);
}

function xAxis(ticks, x, top, bottom, fmt = formatNumber) {
  return [
    svg('line', { class: 'axis', x1: x(ticks[0]), x2: x(ticks[ticks.length - 1]), y1: bottom, y2: bottom }),
    ticks.map((t) => [
      svg('line', { class: 'axis', x1: x(t), x2: x(t), y1: bottom, y2: bottom + 5 }),
      svg('text', { class: 'tick', x: x(t), y: bottom + 18, 'text-anchor': 'middle' }, fmt(t)),
    ]),
  ];
}

function axisTitles(xTitle, yTitle, m, width, height) {
  return [
    xTitle && svg('text', { class: 'axis-title', x: m.l + (width - m.l - m.r) / 2, y: height - 6, 'text-anchor': 'middle' }, xTitle),
    yTitle && svg('text', { class: 'axis-title', transform: `translate(14 ${m.t + (height - m.t - m.b) / 2}) rotate(-90)`, 'text-anchor': 'middle' }, yTitle),
  ];
}

export function histogramChart(data) {
  const m = { t: 24, r: 20, b: 52, l: 64 };
  const { bins, stats } = data;
  const x = scale(bins[0].x0, bins[bins.length - 1].x1, m.l, W - m.r);
  const yTicks = niceTicks(0, Math.max(...bins.map((b) => b.count)), 5);
  const y = scale(0, yTicks[yTicks.length - 1], H - m.b, m.t);
  const xTicks = niceTicks(bins[0].x0, bins[bins.length - 1].x1, 7).filter((t) => t >= bins[0].x0 && t <= bins[bins.length - 1].x1);
  const marker = (value, cls, label, dy) =>
    value >= bins[0].x0 && value <= bins[bins.length - 1].x1 && [
      svg('line', { class: `marker ${cls}`, x1: x(value), x2: x(value), y1: m.t, y2: H - m.b }),
      svg('text', { class: `marker-label ${cls}`, x: x(value) + 4, y: m.t + dy }, `${label} ${formatNumber(value)}`),
    ];
  return frame(W, H, `Histogram of ${data.xLabel}`, [
    yAxis(yTicks, y, m.l, W - m.r, (t) => formatNumber(t)),
    bins.map((b) => {
      const bx = x(b.x0) + 1;
      const bw = Math.max(1, x(b.x1) - x(b.x0) - 2);
      return svg('rect', { class: 'bar', x: bx, y: y(b.count), width: bw, height: H - m.b - y(b.count), 'data-tip': `${formatNumber(b.x0)} to ${formatNumber(b.x1)}: ${b.count} rows` });
    }),
    xAxis(xTicks.length > 1 ? xTicks : [bins[0].x0, bins[bins.length - 1].x1], x, m.t, H - m.b),
    marker(stats.mean, 'mean', 'mean', 2),
    marker(stats.median, 'median', 'median', 16),
    axisTitles(data.xLabel, 'Rows', m, W, H),
  ]);
}

export function barChart(data) {
  const { bars } = data;
  const longest = Math.max(...bars.map((b) => Math.min(24, b.label.length)));
  const hasNotes = bars.some((b) => b.note);
  const m = { t: 12, r: hasNotes ? 130 : 70, b: 44, l: Math.min(200, 16 + longest * 7.2) };
  const rowH = 26;
  const height = m.t + m.b + bars.length * rowH;
  const lo = Math.min(0, ...bars.map((b) => b.value));
  const hi = Math.max(0, ...bars.map((b) => b.value));
  const ticks = niceTicks(lo, hi, 5);
  const x = scale(ticks[0], ticks[ticks.length - 1], m.l, W - m.r);
  return frame(W, height, `Bar chart of ${data.valueLabel} by ${data.xLabel}`, [
    ticks.map((t) => [
      svg('line', { class: 'grid', x1: x(t), x2: x(t), y1: m.t, y2: height - m.b }),
      svg('text', { class: 'tick', x: x(t), y: height - m.b + 18, 'text-anchor': 'middle' }, formatNumber(t)),
    ]),
    bars.map((b, i) => {
      const top = m.t + i * rowH + 4;
      const x0 = x(Math.min(0, b.value));
      const w = Math.max(1, Math.abs(x(b.value) - x(0)));
      return [
        svg('text', { class: 'tick label', x: m.l - 8, y: top + (rowH - 8) / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, truncate(b.label, 24)),
        svg('rect', { class: b.tone ? `bar ${b.tone}` : 'bar', x: x0, y: top, width: w, height: rowH - 8, rx: 3, 'data-tip': `${b.label}: ${formatNumber(b.value)}${b.note ? ` (${b.note})` : ''}` }),
        svg('text', { class: 'value', x: b.value < 0 ? x(0) + 6 : x0 + w + 6, y: top + (rowH - 8) / 2, 'dominant-baseline': 'middle' }, `${formatNumber(b.value)}${b.note ? ` · ${b.note}` : ''}`),
      ];
    }),
    svg('line', { class: 'axis', x1: x(0), x2: x(0), y1: m.t, y2: height - m.b }),
    svg('text', { class: 'axis-title', x: m.l + (W - m.l - m.r) / 2, y: height - 6, 'text-anchor': 'middle' }, data.valueLabel),
  ]);
}

function legendRow(legend, left) {
  let x = left;
  return legend.map((item, i) => {
    const text = truncate(item.label, 16);
    const g = [
      svg('circle', { class: `legend-dot c${i}`, cx: x + 5, cy: 12, r: 5 }),
      svg('text', { class: 'tick label', x: x + 14, y: 12, 'dominant-baseline': 'middle' }, text),
    ];
    x += 26 + text.length * 6.6;
    return g;
  });
}

export function scatterChart(data) {
  const m = { t: data.legend ? 36 : 20, r: 24, b: 52, l: 68 };
  const [x0, x1] = extent(data.points.map((p) => p.x));
  const [y0, y1] = extent(data.points.map((p) => p.y));
  const xt = niceTicks(x0, x1, 7);
  const yt = niceTicks(y0, y1, 6);
  const x = scale(xt[0], xt[xt.length - 1], m.l, W - m.r);
  const y = scale(yt[0], yt[yt.length - 1], H - m.b, m.t);
  const reg = data.regression;
  const r = 2.2 + 2 / Math.sqrt(Math.max(1, data.points.length / 100));
  return frame(W, H, `Scatter plot of ${data.yLabel} against ${data.xLabel}`, [
    yAxis(yt, y, m.l, W - m.r),
    xAxis(xt, x, m.t, H - m.b),
    data.points.map((p) =>
      svg('circle', {
        class: p.g == null ? 'dot' : `dot c${p.g}`, cx: x(p.x), cy: y(p.y), r,
        'data-tip': `Row ${p.row + 1}: ${data.xLabel} ${formatNumber(p.x)}, ${data.yLabel} ${formatNumber(p.y)}${p.g == null ? '' : ` (${data.legend[p.g].label})`}`,
      })
    ),
    data.legend && legendRow(data.legend, m.l),
    reg && svg('line', {
      class: data.legend ? 'trend neutral' : 'trend',
      x1: x(xt[0]), y1: y(reg.intercept + reg.slope * xt[0]),
      x2: x(xt[xt.length - 1]), y2: y(reg.intercept + reg.slope * xt[xt.length - 1]),
      'clip-path': 'url(#plot-clip)',
      'data-tip': `Trend line: ${data.yLabel} ≈ ${formatNumber(reg.slope)} × ${data.xLabel} + ${formatNumber(reg.intercept)}  (R² = ${reg.r2.toFixed(2)})`,
    }),
    svg('clipPath', { id: 'plot-clip' }, svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b })),
    axisTitles(data.xLabel, data.yLabel, m, W, H),
  ]);
}

export function lineChart(data) {
  const m = { t: data.series || data.annotations?.length ? 36 : 20, r: 24, b: 52, l: 68 };
  const pts = data.points;
  const fc = data.forecast?.points ?? null;
  const [x0, x1] = extent([...pts.map((p) => p.x), ...(fc ? fc.map((p) => p.x) : [])]);
  const [y0, y1] = extent([...pts.map((p) => p.y), ...(fc ? fc.flatMap((p) => [p.lo, p.hi]) : [])]);
  const yt = niceTicks(Math.min(0, y0), y1, 6);
  const y = scale(yt[0], yt[yt.length - 1], H - m.b, m.t);
  let x;
  let axis;
  if (data.xIsDate) {
    x = scale(x0, x1, m.l, W - m.r);
    const { ticks, fmt } = timeTicks(x0, x1);
    axis = ticks.length ? xAxis(ticks, x, m.t, H - m.b, fmt) : [];
  } else {
    const xt = niceTicks(x0, x1, 7);
    x = scale(xt[0], xt[xt.length - 1], m.l, W - m.r);
    axis = xAxis(xt, x, m.t, H - m.b);
  }
  const fmtX = data.xIsDate ? (t) => (data.unit === 'month' ? formatDate(t).replace(/ \d+,/, '') : data.unit === 'year' ? String(new Date(t).getUTCFullYear()) : formatDate(t)) : formatNumber;
  const path = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const notes = (data.annotations ?? []).filter((n) => n.x >= x0 && n.x <= x1).map((n, k) => [
    svg('line', { class: 'note-line', x1: x(n.x), x2: x(n.x), y1: m.t - 4, y2: H - m.b }),
    svg('text', { class: 'note-label', x: x(n.x) + 4, y: m.t + 8 + (k % 3) * 13, 'data-tip': `${fmtX(n.x)}: ${n.text}` }, truncate(n.text, 28)),
  ]);
  if (data.series) {
    return frame(W, H, `Line chart of ${data.yLabel} over ${data.xLabel}, one line per ${data.colorLabel}`, [
      yAxis(yt, y, m.l, W - m.r),
      axis,
      data.series.map((sr, g) => [
        svg('path', { class: `series-line c${g}`, d: path(sr.points) }),
        sr.points.length <= 80 && sr.points.map((p) => svg('circle', { class: `dot point c${g}`, cx: x(p.x), cy: y(p.y), r: 3, 'data-tip': `${sr.label}, ${fmtX(p.x)}: ${formatNumber(p.y)}` })),
      ]),
      legendRow(data.legend, m.l),
      notes,
      axisTitles(data.xLabel, data.yLabel, m, W, H),
    ]);
  }
  const d = path(pts);
  const area = `${d}L${x(pts[pts.length - 1].x).toFixed(1)},${y(yt[0])}L${x(pts[0].x).toFixed(1)},${y(yt[0])}Z`;
  return frame(W, H, `Line chart of ${data.yLabel} over ${data.xLabel}`, [
    yAxis(yt, y, m.l, W - m.r),
    axis,
    svg('path', { class: 'area', d: area }),
    svg('path', { class: data.smooth ? 'line faint' : 'line', d }),
    data.smooth && svg('path', { class: 'smooth', d: data.smooth.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('') }),
    pts.map((p) =>
      svg('circle', { class: pts.length <= 60 ? 'dot point' : 'hover-point', cx: x(p.x), cy: y(p.y), r: pts.length <= 60 ? 3.5 : 4, 'data-tip': `${fmtX(p.x)}: ${formatNumber(p.y)}` })
    ),
    fc && forecastLayer(fc, pts[pts.length - 1], x, y, m, fmtX),
    (data.highlights ?? []).map((h) => [
      svg('circle', { class: 'anomaly', cx: x(h.x), cy: y(h.y), r: 7, 'data-tip': h.label }),
      svg('circle', { class: 'anomaly-dot', cx: x(h.x), cy: y(h.y), r: 3 }),
    ]),
    notes,
    axisTitles(data.xLabel, data.yLabel, m, W, H),
  ]);
}

/** Dashed forecast line with its shaded "likely range", starting from the last real point. */
function forecastLayer(fc, last, x, y, m, fmtX) {
  const P = (px, py) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`;
  const band = `M${P(last.x, last.y)}${fc.map((p) => `L${P(p.x, p.hi)}`).join('')}${[...fc].reverse().map((p) => `L${P(p.x, p.lo)}`).join('')}Z`;
  const line = `M${P(last.x, last.y)}${fc.map((p) => `L${P(p.x, p.y)}`).join('')}`;
  const divider = x(last.x);
  return [
    svg('line', { class: 'forecast-divider', x1: divider, x2: divider, y1: m.t, y2: H - m.b }),
    svg('text', { class: 'forecast-label', x: divider + 6, y: m.t + 12 }, 'Forecast →'),
    svg('path', { class: 'forecast-band', d: band }),
    svg('path', { class: 'forecast-line', d: line }),
    fc.map((p) => svg('circle', {
      class: 'hover-point', cx: x(p.x), cy: y(p.y), r: 5,
      'data-tip': `Forecast ${fmtX(p.x)}: ${formatNumber(p.y)} (likely ${formatNumber(p.lo)} to ${formatNumber(p.hi)})`,
    })),
  ];
}

export function boxChart(data) {
  const m = { t: 20, r: 24, b: data.groups.length > 1 ? 64 : 40, l: 68 };
  const all = data.groups.flatMap((g) => [g.stats.min, g.stats.max]);
  const yt = niceTicks(Math.min(...all), Math.max(...all), 6);
  const y = scale(yt[0], yt[yt.length - 1], H - m.b, m.t);
  const slot = (W - m.l - m.r) / data.groups.length;
  const boxW = Math.min(80, slot * 0.55);
  return frame(W, H, `Box plot of ${data.valueLabel}`, [
    yAxis(yt, y, m.l, W - m.r),
    data.groups.map((g, i) => {
      const s = g.stats;
      const cx = m.l + slot * (i + 0.5);
      let wLo = s.max;
      let wHi = s.min;
      for (const v of g.values) {
        if (v >= s.lowerFence && v < wLo) wLo = v;
        if (v <= s.upperFence && v > wHi) wHi = v;
      }
      const outliers = g.values.filter((v) => v < s.lowerFence || v > s.upperFence).slice(0, 300);
      const tip = `${g.label}: median ${formatNumber(s.median)}, middle half ${formatNumber(s.q1)} to ${formatNumber(s.q3)}, ${s.count} rows`;
      return [
        svg('line', { class: 'whisker', x1: cx, x2: cx, y1: y(wLo), y2: y(s.q1) }),
        svg('line', { class: 'whisker', x1: cx, x2: cx, y1: y(s.q3), y2: y(wHi) }),
        svg('line', { class: 'whisker', x1: cx - boxW / 4, x2: cx + boxW / 4, y1: y(wLo), y2: y(wLo) }),
        svg('line', { class: 'whisker', x1: cx - boxW / 4, x2: cx + boxW / 4, y1: y(wHi), y2: y(wHi) }),
        svg('rect', { class: 'box', x: cx - boxW / 2, y: y(s.q3), width: boxW, height: Math.max(1, y(s.q1) - y(s.q3)), rx: 3, 'data-tip': tip }),
        svg('line', { class: 'median-line', x1: cx - boxW / 2, x2: cx + boxW / 2, y1: y(s.median), y2: y(s.median) }),
        outliers.map((v) => svg('circle', { class: 'outlier', cx, cy: y(v), r: 3.5, 'data-tip': `Outlier: ${formatNumber(v)}` })),
        data.groups.length > 1 && svg('text', { class: 'tick label', x: cx, y: H - m.b + 18, 'text-anchor': 'middle' }, truncate(g.label, Math.max(4, Math.floor(slot / 7)))),
      ];
    }),
    axisTitles(data.groups.length > 1 ? data.groupLabel : null, data.valueLabel, m, W, H),
  ]);
}

/** Correlation matrix as a coloured grid. Blue = positive, orange = negative. */
export function heatmap(names, matrix) {
  const n = names.length;
  const cell = Math.max(34, Math.min(56, 520 / n));
  const labelW = Math.min(170, 12 + Math.max(...names.map((s) => Math.min(22, s.length))) * 7);
  const top = labelW * 0.72;
  const width = labelW + n * cell + 10;
  const height = top + n * cell + 10;
  const chart = frame(width, height, 'Correlation matrix', [
    names.map((name, i) => [
      svg('text', { class: 'tick label', x: labelW - 8, y: top + i * cell + cell / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, truncate(name, 22)),
      svg('text', { class: 'tick label', transform: `translate(${labelW + i * cell + cell / 2} ${top - 8}) rotate(-45)` }, truncate(name, 22)),
    ]),
    matrix.map((row, i) =>
      row.map((r, j) => {
        const ok = Number.isFinite(r);
        return [
          svg('rect', {
            class: `cell ${ok && r < 0 ? 'neg' : 'pos'}`,
            x: labelW + j * cell + 1, y: top + i * cell + 1, width: cell - 2, height: cell - 2, rx: 3,
            style: `fill-opacity:${ok ? Math.max(0.06, Math.abs(r)) : 0.04}`,
            'data-tip': ok ? `${names[i]} vs ${names[j]}: r = ${r.toFixed(2)}` : 'Not enough data',
          }),
          svg('text', { class: `cell-label${ok && Math.abs(r) > 0.55 ? ' strong' : ''}`, x: labelW + j * cell + cell / 2, y: top + i * cell + cell / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, ok ? r.toFixed(2) : '–'),
        ];
      })
    ),
  ]);
  chart.style.maxWidth = `${width}px`;
  return chart;
}

/** Small histogram for column cards. */
export function sparkHistogram(bins) {
  const w = 220;
  const h = 48;
  const max = Math.max(...bins.map((b) => b.count));
  const bw = w / bins.length;
  return svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark', 'aria-hidden': 'true' },
    bins.map((b, i) => {
      const bh = max ? (b.count / max) * (h - 2) : 0;
      return svg('rect', { class: 'bar', x: i * bw + 0.5, y: h - bh, width: Math.max(1, bw - 1), height: bh, 'data-tip': `${formatNumber(b.x0)} to ${formatNumber(b.x1)}: ${b.count}` });
    })
  );
}

/** Bars split into coloured parts (one per group), with a legend. */
export function stackedBarChart(data) {
  const { bars } = data;
  const longest = Math.max(...bars.map((b) => Math.min(24, b.label.length)));
  const m = { t: 36, r: 70, b: 44, l: Math.min(200, 16 + longest * 7.2) };
  const rowH = 26;
  const height = m.t + m.b + bars.length * rowH;
  const ticks = niceTicks(0, Math.max(...bars.map((b) => b.value)), 5);
  const x = scale(0, ticks[ticks.length - 1], m.l, W - m.r);
  return frame(W, height, `Stacked bar chart of ${data.valueLabel} by ${data.xLabel}, split by ${data.colorLabel}`, [
    legendRow(data.legend, m.l),
    ticks.map((t) => [
      svg('line', { class: 'grid', x1: x(t), x2: x(t), y1: m.t, y2: height - m.b }),
      svg('text', { class: 'tick', x: x(t), y: height - m.b + 18, 'text-anchor': 'middle' }, formatNumber(t)),
    ]),
    bars.map((b, i) => {
      const top = m.t + i * rowH + 4;
      let start = 0;
      return [
        svg('text', { class: 'tick label', x: m.l - 8, y: top + (rowH - 8) / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, truncate(b.label, 24)),
        b.parts.map((v, g) => {
          if (!v) return null;
          const rect = svg('rect', { class: `stack c${g}`, x: x(start), y: top, width: Math.max(0.5, x(start + v) - x(start)), height: rowH - 8, 'data-tip': `${b.label} · ${data.legend[g].label}: ${formatNumber(v)} (${Math.round((v / b.value) * 100)}%)` });
          start += v;
          return rect;
        }),
        svg('text', { class: 'value', x: x(b.value) + 6, y: top + (rowH - 8) / 2, 'dominant-baseline': 'middle' }, formatNumber(b.value)),
      ];
    }),
    svg('text', { class: 'axis-title', x: m.l + (W - m.l - m.r) / 2, y: height - 6, 'text-anchor': 'middle' }, data.valueLabel),
  ]);
}

/** One square per day, darker for bigger totals: weeks run left to right, Monday at the top. */
export function calendarChart(data) {
  const size = 12;
  const gap = 2;
  const left = 34;
  const top = 22;
  const first = data.cells[0].day;
  const firstWeekday = (new Date(first).getUTCDay() + 6) % 7;
  const weeks = Math.ceil((data.cells.length + firstWeekday) / 7);
  const width = left + weeks * (size + gap) + 10;
  const height = top + 7 * (size + gap) + 30;
  const values = data.cells.map((c) => c.value).filter((v) => v != null);
  const max = Math.max(...values, 0) || 1;
  const months = [];
  return frame(Math.max(width, 300), height, `Calendar heatmap of ${data.valueLabel} per day`, [
    ['Mon', 'Wed', 'Fri'].map((d, k) => svg('text', { class: 'tick label', x: left - 6, y: top + (k * 2) * (size + gap) + size - 2, 'text-anchor': 'end' }, d)),
    data.cells.map((c, k) => {
      const pos = k + firstWeekday;
      const wk = Math.floor(pos / 7);
      const dow = pos % 7;
      const date = new Date(c.day);
      if (date.getUTCDate() === 1) months.push(svg('text', { class: 'tick label', x: left + wk * (size + gap), y: top - 8 }, formatDate(c.day).replace(/ \d+,.*/, '')));
      const level = c.value == null ? null : Math.ceil((c.value / max) * 4);
      return svg('rect', { class: `cal-day l${level ?? 'x'}`, x: left + wk * (size + gap), y: top + dow * (size + gap), width: size, height: size, rx: 2, 'data-tip': `${formatDate(c.day)}: ${c.value == null ? 'no data' : formatNumber(c.value)}` });
    }),
    months,
    svg('text', { class: 'axis-title', x: left, y: height - 6 }, `${data.valueLabel} per day · darker = more`),
  ]);
}

/** The numbers behind a chart, as a plain table (for "Show the numbers" and screen readers). */
export function chartTable(data) {
  let headers;
  let rows;
  switch (data.type) {
    case 'bar':
      headers = [data.xLabel, data.valueLabel];
      rows = data.bars.map((b) => [b.label, formatNumber(b.value) + (b.note ? ` (${b.note})` : '')]);
      break;
    case 'stacked':
      headers = [data.xLabel, ...data.legend.map((l) => l.label), 'Total'];
      rows = data.bars.map((b) => [b.label, ...b.parts.map(formatNumber), formatNumber(b.value)]);
      break;
    case 'histogram':
      headers = [`${data.xLabel} from`, 'to', 'Rows'];
      rows = data.bins.map((b) => [formatNumber(b.x0), formatNumber(b.x1), b.count]);
      break;
    case 'scatter':
      headers = [data.xLabel, data.yLabel, ...(data.legend ? [data.colorLabel] : [])];
      rows = data.points.slice(0, 500).map((p) => [formatNumber(p.x), formatNumber(p.y), ...(data.legend ? [data.legend[p.g]?.label ?? ''] : [])]);
      break;
    case 'box':
      headers = [data.groupLabel ?? '', 'Rows', 'Min', 'Q1', 'Median', 'Q3', 'Max'];
      rows = data.groups.map((g) => [g.label, g.stats.count, ...[g.stats.min, g.stats.q1, g.stats.median, g.stats.q3, g.stats.max].map(formatNumber)]);
      break;
    case 'calendar':
      headers = ['Date', data.valueLabel];
      rows = data.cells.filter((c) => c.value != null).map((c) => [formatDate(c.day), formatNumber(c.value)]);
      break;
    case 'line': {
      const fmtX = (v) => (data.xIsDate ? formatDate(v) : formatNumber(v));
      if (data.series) {
        const xs = [...new Set(data.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
        const lookup = data.series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
        headers = [data.xLabel, ...data.series.map((s) => s.label)];
        rows = xs.map((xv) => [fmtX(xv), ...lookup.map((m) => (m.has(xv) ? formatNumber(m.get(xv)) : ''))]);
      } else {
        headers = [data.xLabel, data.yLabel, ...(data.forecast?.points ? ['Forecast'] : [])];
        rows = [...data.points.map((p) => [fmtX(p.x), formatNumber(p.y), ...(data.forecast?.points ? [''] : [])]),
          ...(data.forecast?.points ?? []).map((p) => [fmtX(p.x), '', `${formatNumber(p.y)} (${formatNumber(p.lo)} to ${formatNumber(p.hi)})`])];
      }
      break;
    }
    default:
      return null;
  }
  const more = data.type === 'scatter' && data.points.length > 500 ? `Showing the first 500 of ${data.points.length} points.` : null;
  return el('div', { class: 'chart-table' },
    el('div', { class: 'scroll-x' }, el('table', { class: 'data-table compact' },
      el('thead', {}, el('tr', {}, headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v, j) => el('td', { class: j ? 'num' : '' }, String(v)))))))),
    more && el('p', { class: 'muted small' }, more));
}

/** A chart with a "Show the numbers" switch underneath. */
export function chartWithTable(data) {
  const chart = renderChart(data);
  let table = null;
  const holder = el('div', {});
  const toggle = el('button', {
    class: 'link-btn small', type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      table ??= chartTable(data);
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Hide the numbers' : 'Show the numbers';
      holder.replaceChildren(...(open && table ? [table] : []));
    },
  }, 'Show the numbers');
  return el('div', { class: 'chart-block' }, el('div', { class: 'chart-wrap' }, chart), el('div', { class: 'chart-table-toggle' }, toggle), holder);
}

export function renderChart(data) {
  switch (data.type) {
    case 'stacked': return stackedBarChart(data);
    case 'calendar': return calendarChart(data);
    case 'histogram': return histogramChart(data);
    case 'bar': return barChart(data);
    case 'scatter': return scatterChart(data);
    case 'line': return lineChart(data);
    case 'box': return boxChart(data);
    default: throw new Error(`Unknown chart type ${data.type}`);
  }
}
