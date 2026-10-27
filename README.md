# Lumora

<p align="center"><img src="assets/logo-192.png" alt="Lumora logo" width="96" height="96"></p>

**Data analysis that is easy to use and easy to learn.**

Drop in a spreadsheet and Lumora tells you what is inside in plain English. It flags problems and interesting patterns, picks the right chart, and teaches you the statistics along the way. Everything runs in your browser, so your data is never uploaded.

## Features

- **Instant loading, even for big files.** Drag and drop (or paste) **Excel (.xlsx)**, CSV, TSV or JSON. Workbooks with several sheets ask which sheet to open. Files are read in a background worker with a progress bar, so files with millions of rows don't freeze the page. A 1-million-row CSV (38 MB) loads in about 12 seconds, with the page responsive throughout. On very large data, the Overview's insights and Key drivers use an evenly spread sample, and say so. Counts, filters, tables, summaries and exports always use every row.
- **Combine files.** Drop several files with the same columns at once to stack them, with a "source" column recording which file each row came from. Or use Clean → *Combine with another file* to stack rows or **join columns** on a shared column (orders + customers). Lumora suggests the matching columns, previews how many rows match, and warns about duplicates before you commit. Like every cleaning step, it can be undone.
- **Two-way pivot tables.** In Summarize, choose *Split into columns by* to get, for example, average customers by weekday × month, with heat-map shading and correct totals.
- **Forecasts.** On any line chart over dates, turn on *Forecast* to project the next days or months with a shaded 80% likely range. It uses Holt-Winters smoothing with weekly or yearly patterns, and a back-test that says how accurate it was on past data. Ask "forecast revenue" also works.
- **Export to Excel.** Data, summaries, pivot tables and charts export as real `.xlsx` files: typed cells (numbers, dates, yes/no), a bold, filterable, frozen header row, and **native, editable Excel charts** next to the data. Lumora detects the delimiter and works out each column's type: number, date, yes/no, category or text. You can override any type with one click.
- **Ask questions in plain English.** For example "which weekday has the most customers", "total revenue on rainy days", "exam score over time" or "what drives exam score". You get a one-line answer, a table and a chart. Lumora always shows how it understood the question, so you can check it. It runs fully on-device, with no AI service and no data sent anywhere. Press `/` to ask from anywhere.
- **Key drivers.** Pick a column and see every other column ranked by how much of its variation it explains, with plain-English explanations and a reminder that related does not mean caused.
- **Reports.** Pin charts, summaries, answers and key drivers, add notes, reorder them, then print or save as PDF. Report items stay live, so they update when the data is cleaned and follow renamed columns.
- **Auto-save and projects.** Work is saved in the browser as you go and listed under "Continue where you left off" on the start screen. **Save project** downloads a `.lumora` file (data, cleaning steps, settings and report) that you can reopen or share.
- **Automatic insights.** It finds missing data, strong correlations, outliers, skewed columns, big differences between groups, ID columns and date ranges. A **Show me →** button opens the chart that proves each finding.
- **Column profiles.** Each column gets a mini histogram or top values, plus a full statistics panel (mean, median, quartiles, IQR, skewness, outliers, …).
- **Chart builder with "Auto" mode.** Choose columns and Lumora picks a histogram, bar, scatter (with trend line and R²), line (with moving average) or box plot, and explains *why* it chose that chart.
- **"Is this real, or just luck?"** Below each chart, Lumora runs the right significance test (correlation test, Welch's t-test, one-way ANOVA or chi-square). It explains the p-value, the effect size and the confidence interval in plain English.
- **Analyses: "What do you want to find out?"** Pick a plain question and Lumora answers in one sentence, with the chart and details behind it. It shows only the questions your data can answer and chooses sensible settings (it measures revenue rather than an ID, compares weekends with weekdays, and allows for busy Saturdays when looking for unusual days):
  - *Why did it change?* Breaks the change between two periods down by the groups that caused it.
  - *How do two groups differ?* Every number side by side, with a "real or luck?" verdict.
  - *What affects a number?* Key drivers.
  - *What makes up most of the total?* The 80/20 split.
  - *Were there any unusual days?*
  - *Is it growing, and when is it busiest?* Trend, weekly and yearly pattern.
  - *What if something changes?* Sliders on a prediction model.
  - *Are there natural groups?* Clusters, described in words, which you can save as a column.
  - *Does one thing affect another later?* Delayed effects.
  - *Do people come back?* Monthly return rates.
  - *Where do people drop off?* Funnels.
  - *What are people saying?* Themes and tone in written answers.
- **Form maker: collect your own data.** Design a form with short or long answers, numbers (with limits), dates, ratings, yes/no, and one or several choices, or start from a template (customer feedback, event sign-up, stock count, expense log, daily check-in). Fill it in on this device for fast data entry, or share a link: the whole form travels inside the link, so there's no account or server. Each person gets a short answer code (and an email button if you add your address) to send back; paste the codes under *Responses → Import answers*. Duplicates are skipped and every answer is re-checked. The Responses page summarises each question, and **Analyse in Lumora** turns the answers into a typed dataset, with a yes/no column for each checkbox option.
- **Data health check.** A score out of 100 on the Overview, and a list of problems in the Clean tab: duplicate rows, spelling variants ("NY", "ny", " NY "), numbers or dates stored as text, values that can't be read as numbers, and empty or constant columns. Each has a one-click fix, and **Fix all safe problems** applies every fix that doesn't remove information.
- **Cleaning recipes.** Lumora remembers your cleaning steps. When you open another file with the same columns (next month's export, say), it offers to clean it the same way in one click, matching column types first so a messier file gets the same treatment. Save a recipe as a file to share it or apply it later.
- **Search everything (Ctrl+K / ⌘K).** Type a few letters to jump to a tab, open a column's details, chart or sort by a column, export, undo or start a lesson.
- **Clean tab with undo.** Remove duplicates (across every column, or by a chosen column such as email), fill or drop missing values (median, mean, most common, previous row, or a value you choose), tidy text, **find and replace**, **split a column** ("London, UK" → two columns), **group values** (numbers into ranges such as "20 – 30", or the top categories plus "Other"), pull out **date parts** (month, weekday, quarter, year), rename or delete columns, and make filters permanent. Every action is recorded as a step. Undo with Ctrl+Z, remove any step from the history, or start over. The original file is never changed.
- **Calculated columns** with a safe formula language, e.g. `round(revenue / customers, 2)` or `if(temperature_c > 20, "hot", "cold")`. It shows a live preview and suggests a fix when you mistype a column name.
- **Color-by-category scatter plots** and **chart downloads** as high-resolution PNG or SVG.
- **Filters** that apply everywhere: overview, table, charts and summaries.
- **Group & summarize** (pivot tables) with count, sum, mean, median, min, max, standard deviation and distinct counts. Dates can be grouped by day, month, year or weekday.
- **Searchable, sortable table** and **CSV export** of filtered data and summaries.
- **Learn mode.** Plain-English tips appear throughout the app, every statistic links to a glossary entry, and **twelve guided lessons** use built-in practice datasets.
- **Self-updating.** New versions download in the background and install automatically. If you have data open, Lumora asks first so nothing is lost. A "What's new" note appears after each update. It also works offline and can be installed as an app.
- Light and dark themes, a layout that works on phones, and no dependencies.

## Run it

```bash
npm start        # http://localhost:5173
npm test         # unit tests (Node 18+)
```

There is no build step. Any static host (GitHub Pages, Netlify, …) can serve the repository as is. Add `?sample=coffee` or `?sample=students` to the URL to open with practice data.

## Install it as an app

Lumora installs as an app on Android (APK), Windows, Mac and Linux, and from the browser. GitHub
builds the files automatically. See [apps/README.md](apps/README.md) for downloads, install steps
and signing.

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
src/app.js                UI: home, overview, table, chart, summarize, drivers, clean, report, learn
src/worker.js             background file loader (Web Worker)
src/version.js            app version and user-facing changelog
sw.js, manifest.webmanifest  offline cache, self-updating, installable app
src/ui/                   DOM helpers, SVG charts, chart export, update handling, storage, form maker screens, Android bridge
apps/                     Android APK and desktop installers (see apps/README.md)
src/core/                 Pure, tested logic (no DOM):
  csv.js                    CSV/TSV/JSON parsing
  infer.js                  type detection and conversion
  stats.js                  descriptive stats, histogram, correlation, regression
  transform.js              filter, sort, group-by, formatting, export
  insights.js               automatic plain-English findings
  ask.js                    plain-English question parser
  drivers.js                key-driver ranking
  project.js                save/restore projects (.lumora files)
  clean.js                  replayable cleaning steps (powers undo)
  health.js                 data health check and one-click fixes
  recipe.js                 reusable cleaning recipes
  palette.js                command palette matching (Ctrl+K)
  forms.js                  form maker: questions, validation, share links, answer codes
  analyses.js               change breakdown, group comparison, unusual days, 80/20, text themes
  analyses-more.js          natural groups, what-if model, return rates, funnels, trend/pattern, delayed effects
  encoding.js               file encodings (UTF-8, Windows-1252, UTF-16)
  formula.js                safe formula parser/evaluator for calculated columns
  significance.js           t-test, ANOVA, chi-square, correlation test + verdicts
  xlsx.js                   dependency-free Excel reader
  xlsxwrite.js              dependency-free Excel writer with native charts
  combine.js                stack (append) and join datasets
  forecast.js               Holt-Winters forecasting with prediction intervals and back-test
  overview.js               Overview numbers (shared by the page and the worker)
  pack.js                   fast hand-off of datasets between worker and page
  chartspec.js              chart suggestion and chart data preparation
  learn.js                  glossary and guided lessons
  samples.js                deterministic practice datasets
tests/                    node:test unit tests
```

## Roadmap ideas

1. **Optional AI assistant** for open-ended questions the on-device parser can't handle (opt-in, with clear notice before any data leaves the device).
2. **Multiple regression** ("what explains sales, all factors together?").
3. **Share a report as a link.**
4. **Connections** to Google Sheets and databases.
5. **Progress tracking** for lessons, plus quizzes and achievements.
