// The app version. Bump it (together with package.json, sw.js and the changelog)
// for every release: that change is what tells installed copies to update.
// `npm test` fails if the four ever disagree.
export const VERSION = '0.3.0';

/** User-facing release notes, newest first. Shown in "What's new". */
export const CHANGELOG = [
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
