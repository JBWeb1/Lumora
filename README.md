# Lumora

<p align="center"><img src="assets/logo-192.png" alt="Lumora logo" width="96" height="96"></p>

**Data analysis that is easy to use and easy to learn.**

Drop in a spreadsheet and Lumora tells you what is inside in plain English. It flags problems and interesting patterns, picks the right chart, and teaches you the statistics along the way. Everything runs in your browser, so your data is never uploaded.

## Features

- **Instant loading.** Drag and drop (or paste) **Excel (.xlsx)**, CSV, TSV or JSON. Workbooks with several sheets ask which sheet to open. Lumora detects the delimiter and works out each column's type: number, date, yes/no, category or text. You can override any type with one click.
- **Automatic insights.** It finds missing data, strong correlations, outliers, skewed columns, big differences between groups, ID columns and date ranges. A **Show me →** button opens the chart that proves each finding.
- **Column profiles.** Each column gets a mini histogram or top values, plus a full statistics panel (mean, median, quartiles, IQR, skewness, outliers, …).
- **Chart builder with "Auto" mode.** Choose columns and Lumora picks a histogram, bar, scatter (with trend line and R²), line (with moving average) or box plot, and explains *why* it chose that chart.
- **"Is this real, or just luck?"** Below each chart, Lumora runs the right significance test (correlation test, Welch's t-test, one-way ANOVA or chi-square). It explains the p-value, the effect size and the confidence interval in plain English.
- **Clean tab with undo.** Remove duplicates, fill or drop missing values (median, mean, most common, previous row, or a value you choose), tidy text, rename or delete columns, and make filters permanent. Every action is recorded as a step, so you can undo with Ctrl+Z or start over. The original file is never changed.
- **Calculated columns** with a safe formula language, e.g. `round(revenue / customers, 2)` or `if(temperature_c > 20, "hot", "cold")`. It shows a live preview and suggests a fix when you mistype a column name.
- **Color-by-category scatter plots** and **chart downloads** as high-resolution PNG or SVG.
- **Filters** that apply everywhere: overview, table, charts and summaries.
- **Group & summarize** (pivot tables) with count, sum, mean, median, min, max, standard deviation and distinct counts. Dates can be grouped by day, month, year or weekday.
- **Searchable, sortable table** and **CSV export** of filtered data and summaries.
- **Learn mode.** Plain-English tips appear throughout the app, every statistic links to a glossary entry, and **eight guided lessons** use built-in practice datasets.
- **Self-updating.** New versions download in the background and install automatically. If you have data open, Lumora asks first so nothing is lost. A "What's new" note appears after each update. It also works offline and can be installed as an app.
- Light and dark themes, a layout that works on phones, and no dependencies.

## Run it

```bash
npm start        # http://localhost:5173
npm test         # unit tests (Node 18+)
```

There is no build step. Any static host (GitHub Pages, Netlify, …) can serve the repository as is. Add `?sample=coffee` or `?sample=students` to the URL to open with practice data.

## Updates and releases

Lumora is a Progressive Web App. `sw.js` (a service worker) keeps a complete copy of the current version for offline use. The browser re-checks it on every visit, every 30 minutes, and when you click **Check for updates**. When a new version is published:

1. The new version downloads in the background while the old one keeps running.
2. If nothing is open, it switches over immediately. If you have data open, a banner offers **Update now** or **Later**. "Later" installs it the next time you return to the start screen.
3. After reloading, a "What's new" note lists the changes.

**To publish a release:**

1. Bump the version in `package.json`, `src/version.js` and `sw.js`, and add release notes to `CHANGELOG` in `src/version.js`. `npm test` fails if these disagree or if a new file is missing from the offline list in `sw.js`.
2. Merge to `main`. The **Deploy** workflow runs the tests and publishes to GitHub Pages. Everyone's copy then updates itself.

One-time setup: in the repository's **Settings → Pages**, set the source to **GitHub Actions**.

During development (`npm start` on localhost) the service worker is off, so edits show up instantly. Add `?sw` to the URL to test offline mode and updates locally.

## Project layout

```
index.html, styles.css    App shell and design system (brand colours from the logo)
assets/                   Logo in several sizes (favicon, app icon)
src/app.js                UI: home, overview, table, chart, summarize, clean, learn
src/version.js            app version and user-facing changelog
sw.js, manifest.webmanifest  offline cache, self-updating, installable app
src/ui/                   DOM helpers, SVG charts, chart export, update handling
src/core/                 Pure, tested logic (no DOM):
  csv.js                    CSV/TSV/JSON parsing
  infer.js                  type detection and conversion
  stats.js                  descriptive stats, histogram, correlation, regression
  transform.js              filter, sort, group-by, formatting, export
  insights.js               automatic plain-English findings
  clean.js                  replayable cleaning steps (powers undo)
  formula.js                safe formula parser/evaluator for calculated columns
  significance.js           t-test, ANOVA, chi-square, correlation test + verdicts
  xlsx.js                   dependency-free Excel reader
  chartspec.js              chart suggestion and chart data preparation
  learn.js                  glossary and guided lessons
  samples.js                deterministic practice datasets
tests/                    node:test unit tests
```

## Roadmap ideas

1. **Ask in plain English.** "Which weekday has the highest revenue?" turns into the right filter, group and chart (powered by an LLM).
2. **Dashboards and reports.** Pin charts, add notes, and share as a link or PDF.
3. **Save projects** (data + cleaning steps + charts) and reopen them later.
4. **Simple forecasting** and multiple regression ("what drives exam scores?").
5. **Connections** to Google Sheets and databases.
6. **Web Worker processing** for files with millions of rows.
7. **Progress tracking** for lessons, plus quizzes and achievements.
