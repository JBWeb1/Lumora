// Opening data from a web link (a published Google Sheet, a CSV on GitHub, an open-data
// portal) so it can be refreshed later with one click.

/**
 * Turn the links people usually copy into a direct CSV download where we can:
 *  - Google Sheets "edit" or "share" links → the sheet's CSV export (needs "Anyone with the link")
 *  - GitHub file pages → the raw file
 * Returns { url, note } where note explains anything the person may need to do.
 */
export function dataUrl(input) {
  const raw = String(input ?? '').trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'That doesn’t look like a web address. It should start with https://' };
  }
  if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https links can be opened.' };
  const sheet = /^\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname);
  if (u.hostname === 'docs.google.com' && sheet && !/\/pub$|\/export$/.test(u.pathname) && !u.pathname.includes('/d/e/')) {
    const gid = /gid=(\d+)/.exec(u.hash + u.search)?.[1];
    return {
      url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`,
      note: 'If this doesn’t load, in Google Sheets choose File → Share → Publish to web → CSV, and paste that link instead.',
    };
  }
  if (u.hostname === 'github.com' && /\/blob\//.test(u.pathname)) {
    return { url: `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}` };
  }
  return { url: u.href };
}

/** A file name for a link: the last part of the path, or the site name. */
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'docs.google.com') return 'Google Sheet.csv';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return /\.\w{2,5}$/.test(last) ? last : `${last || u.hostname}.csv`;
  } catch {
    return 'web data.csv';
  }
}
