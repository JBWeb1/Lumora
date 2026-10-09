# Lumora

**Data analysis that is easy to use and easy to learn.**

Drop in a spreadsheet and Lumora tells you what is inside in plain English. It flags problems and interesting patterns, picks the right chart, and teaches you the statistics along the way. Everything runs in your browser, so your data is never uploaded.

## Features

- **Instant loading.** Drag and drop (or paste) CSV, TSV or JSON. Lumora detects the delimiter and works out each column's type: number, date, yes/no, category or text. You can override any type with one click.
- **Automatic insights.** It finds missing data, strong correlations, outliers, skewed columns, big differences between groups, ID columns and date ranges. A **Show me →** button opens the chart that proves each finding.
- **Column profiles.** Each column gets a mini histogram or top values, plus a full statistics panel (mean, median, quartiles, IQR, skewness, outliers, …).
- **Chart builder with "Auto" mode.** Choose columns and Lumora picks a histogram, bar, scatter (with trend line and R²), line (with moving average) or box plot, and explains *why* it chose that chart.
- **Filters** that apply everywhere: overview, table, charts and summaries.
- **Group & summarize** (pivot tables) with count, sum, mean, median, min, max, standard deviation and distinct counts. Dates can be grouped by day, month, year or weekday.
- **Searchable, sortable table** and **CSV export** of filtered data and summaries.
- **Learn mode.** Plain-English tips appear throughout the app, every statistic links to a glossary entry, and **six guided lessons** use built-in practice datasets.
- Light and dark themes, a layout that works on phones, and no dependencies.

## Run it

```bash
npm start        # http://localhost:5173
npm test         # unit tests (Node 18+)
```

There is no build step. Any static host (GitHub Pages, Netlify, …) can serve the repository as is. Add `?sample=coffee` or `?sample=students` to the URL to open with practice data.

## Project layout

```
index.html, styles.css    App shell and design system
src/app.js                UI: home, overview, table, chart, summarize, learn
src/ui/                   DOM helpers and SVG chart rendering
src/core/                 Pure, tested logic (no DOM):
  csv.js                    CSV/TSV/JSON parsing
  infer.js                  type detection and conversion
  stats.js                  descriptive stats, histogram, correlation, regression
  transform.js              filter, sort, group-by, formatting, export
  insights.js               automatic plain-English findings
  chartspec.js              chart suggestion and chart data preparation
  learn.js                  glossary and guided lessons
  samples.js                deterministic practice datasets
tests/                    node:test unit tests
```

## Roadmap ideas

1. **Excel (.xlsx) import** and connections to Google Sheets and databases.
2. **Ask in plain English.** "Which weekday has the highest revenue?" turns into the right filter, group and chart (powered by an LLM).
3. **Data cleaning.** Fill or drop missing values, rename columns, split or merge columns, remove duplicates, with an undoable step history.
4. **Calculated columns** with friendly formulas.
5. **Statistical tests explained simply:** t-test and chi-square ("Is this difference real or luck?").
6. **Dashboards and reports.** Pin charts, add notes, and share as a link or PDF.
7. **Web Worker processing** for files with millions of rows.
8. **Progress tracking** for lessons, plus quizzes and achievements.
