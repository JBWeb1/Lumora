// Ranking for the command palette (Ctrl+K): forgiving "type a few letters" matching.

/**
 * Score how well `query` matches `text`: higher is better, null means no match.
 * Every query letter must appear in order; matches at word starts and in a row score more.
 */
export function fuzzyScore(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 800 - at - t.length / 10 + (/\W/.test(t[at - 1] ?? ' ') ? 100 : 0);
  let score = 0;
  let pos = -1;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const next = t.indexOf(ch, pos + 1);
    if (next < 0) return null;
    run = next === pos + 1 ? run + 1 : 0;
    score += 10 + run * 5 + (next === 0 || /\W/.test(t[next - 1]) ? 15 : 0) - Math.min(next - pos, 10);
    pos = next;
  }
  return score;
}

/** Commands that match, best first. Each command: { title, group, keywords? }. */
export function rankCommands(commands, query, limit = 30) {
  if (!query.trim()) return commands.slice(0, limit);
  return commands
    .map((c) => {
      const title = fuzzyScore(query, c.title);
      const keywords = c.keywords ? fuzzyScore(query, c.keywords) : null;
      const scores = [title, keywords == null ? null : keywords - 50].filter((s) => s != null);
      return { c, s: scores.length ? Math.max(...scores) : null };
    })
    .filter((x) => x.s != null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}
