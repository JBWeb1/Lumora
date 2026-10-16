// The app version. Bump it (together with package.json, sw.js and the changelog)
// for every release: that change is what tells installed copies to update.
// `npm test` fails if the four ever disagree.
export const VERSION = '0.7.0';

/** User-facing release notes, newest first. Shown in "What's new". */
export const CHANGELOG = [
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
