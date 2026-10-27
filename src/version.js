// The app version. Bump it (together with package.json, sw.js and the changelog)
// for every release: that change is what tells installed copies to update.
// `npm test` fails if the four ever disagree.
export const VERSION = '0.10.0';

/** User-facing release notes, newest first. Shown in "What's new". */
export const CHANGELOG = [
  {
    version: '0.10.0',
    date: '2026-10-27',
    items: [
      'Dashboards: switch the Report tab to Dashboard to see everything you pinned as tiles, filter every tile with one click (e.g. Rainy: Yes), present it full screen, or save it as a web page anyone can open.',
      '“Describe this data in words”: Lumora writes a short plain-English summary of your data (quality, trend, latest change, what drives it). Add it to your report and edit it.',
      'New charts: one line per group, stacked bars (choose “Split bars by”), and a calendar heatmap of daily totals.',
      'Add notes to line charts, such as “new menu launched”, shown at that date.',
      '“Show the numbers” under every chart, for exact values and screen readers.',
      'Charts say the unit when your data has one, e.g. “sum of revenue ($)”.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-10-27',
    items: [
      'New Analyses tab: “What do you want to find out?” Pick a plain question and get a one-sentence answer, a chart and the details. Lumora only shows the questions that fit your data and chooses sensible settings for you.',
      'Twelve questions: why did it change, how do two groups differ, what affects a number, what makes up most of the total (80/20), unusual days, trend and busiest times, what-if sliders, natural groups, delayed effects, do people come back, where do people drop off, and what people are saying in written answers.',
      'Quick question buttons on the Overview, and every question is in Search (Ctrl+K). Pin any answer to your report; it stays live.',
      'Save natural groups as a new column, and jump from an unusual day straight to its rows.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-10-27',
    items: [
      'Form maker: design your own forms (short and long answers, numbers, dates, ratings, yes/no, one or several choices), start from five templates, and collect answers on this device or by sharing a link. No account or server: people send back a short answer code, which you import. Then analyse every answer in one click.',
      'Dates are read the same way for a whole column (31.12.2023 style dates no longer flip to month-first on 01.02.2024), and dates such as "Jan 5, 2023" no longer shift by a day in some time zones.',
      'Files saved by Excel on Windows (Windows-1252 or Unicode text) open with accents and £ signs intact.',
      'ZIP codes and long IDs keep their leading zeros and digits; accounting negatives like (1,234) are read as numbers.',
      'Sorting large tables is much faster, and number bar charts are in numeric order.',
      'CSV exports can no longer carry spreadsheet formulas from untrusted data.',
      'Opening a recipe or form file with "Open file" now works, and keyboard focus stays in place when the screen updates.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-16',
    items: [
      'Data health check: a score out of 100 and a list of problems (duplicates, inconsistent spelling, numbers stored as text, unreadable values, empty columns), each with a one-click fix, plus "Fix all safe problems".',
      'New cleaning tools: find and replace, split a column (e.g. "City, State"), group numbers into ranges or keep the top values plus "Other", pull out the month, weekday, quarter or year from a date, and remove duplicates by a chosen column.',
      'Cleaning recipes: Lumora remembers your cleaning steps and offers them when you open a file with the same columns, like next month’s export. Save a recipe to share it or apply it later.',
      'Remove any cleaning step from the history, not just the last one.',
      'Search everything with Ctrl+K (⌘K on Mac): jump to a tab, a column or an action by typing a few letters.',
      'Months, weekdays, quarters and ranges now appear in their natural order in summaries and charts.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-15',
    items: [
      'Lumora now comes as an app: an Android APK for phones and tablets, and installers for Windows, Mac and Linux. They work fully offline.',
      'In the Android app, exports open the share sheet so you can save files to your phone, Drive or email.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-13',
    items: [
      'Combine files: stack files with the same columns (e.g. monthly sales), or add columns from another file by matching a shared column. Drop several files at once to stack them.',
      'Two-way pivot tables: split any summary by a second column, e.g. weekday × month, with shading and totals.',
      'Forecasts on date charts: see the next weeks or months with a shaded likely range, and how accurate the forecast was on past data.',
      'Big files load in the background with a progress bar; files with millions of rows no longer freeze the page.',
      'Export to Excel: data, summaries, pivot tables and charts, with real editable Excel charts.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-10',
    items: [
      'Ask questions in plain English, like "which weekday has the most customers", and get an answer, a table and a chart.',
      'Key drivers: see which columns are most related to the one you care about, ranked and explained.',
      'Reports: pin charts, summaries and answers, add notes, then print or save as PDF.',
      'Your work saves automatically. Pick up where you left off from the start screen, or save a project file to share.',
      'Updating no longer closes your work: it reopens right after the update.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-10',
    items: [
      'Lumora now updates itself: new versions download in the background and install automatically.',
      'Works offline once loaded, and can be installed as an app on your computer or phone.',
      '"What\'s new" notes after each update, and a "Check for updates" button at the bottom of the page.',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-10-10',
    items: ['New Lumora logo and navy, cyan and silver colors to match it.'],
  },
  {
    version: '0.2.0',
    date: '2026-10-09',
    items: [
      'Clean tab: remove duplicates, fix missing values and tidy text, with undo.',
      'Calculated columns using simple formulas.',
      '"Is this real, or just luck?": significance tests explained in plain English.',
      'Open Excel (.xlsx) files, color scatter plots by category, and download charts.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-09',
    items: ['First release: automatic insights, charts, filters, summaries and guided lessons.'],
  },
];
