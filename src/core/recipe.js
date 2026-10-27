// Cleaning recipes: the list of cleaning steps, saved so it can be re-applied to another
// file with the same columns (e.g. next month's export).
//
// Steps that carry another file's data (stacking and joining) aren't portable, so a recipe
// leaves them out and says how many it skipped.

export const RECIPE_KIND = 'lumora-recipe';
const NOT_PORTABLE = new Set(['append', 'join']);

export const isPortable = (step) => !NOT_PORTABLE.has(step.op);

/**
 * `original` is the dataset the steps were made on: the recipe remembers its column types,
 * so a later file where e.g. a few extra "n/a" values make a number column read as text
 * is treated the same way.
 */
export function makeRecipe(steps, source, original = null) {
  const portable = steps.filter(isPortable);
  const types = original ? Object.fromEntries(original.columns.map((c) => [c.name, c.type])) : {};
  return { kind: RECIPE_KIND, version: 1, source, created: new Date().toISOString(), types, steps: structuredClone(portable), skipped: steps.length - portable.length };
}

/** The steps to replay on `ds`: first matching its column types to the recipe's, then the recipe. */
export function recipeSteps(recipe, ds) {
  const types = recipe.types ?? {};
  const align = ds.columns
    .filter((c) => types[c.name] && types[c.name] !== c.type)
    .map((c) => ({ op: 'setType', column: c.name, type: types[c.name] }));
  return [...align, ...structuredClone(recipe.steps)];
}

export function isRecipe(json) {
  return json?.kind === RECIPE_KIND && Array.isArray(json.steps);
}

/** Columns a recipe expects the file to have (formulas aside, which are checked when applied). */
export function requiredColumns(steps) {
  const made = new Set();
  const needed = new Set();
  const splitFrom = [];
  const use = (name) => {
    if (name == null || made.has(name) || splitFrom.some((p) => name.startsWith(`${p} `))) return;
    needed.add(name);
  };
  for (const s of steps) {
    use(s.column);
    s.columns?.forEach(use);
    s.filters?.forEach((f) => use(f.column));
    if (s.op === 'rename') made.add(s.to);
    use(s.from);
    use(s.values);
    s.keys?.forEach(use);
    if (['formula', 'group', 'dateParts', 'segments'].includes(s.op)) made.add(s.name);
    if (s.op === 'unpivot') {
      made.add(s.nameColumn || 'Column');
      made.add(s.valueColumn || 'Value');
    }
    if (s.op === 'split') splitFrom.push(s.column);
  }
  return [...needed];
}

/** Does this recipe fit the dataset? Returns { fits, missing }. */
export function recipeFits(recipe, ds) {
  const have = new Set(ds.columns.map((c) => c.name));
  const missing = requiredColumns(recipe.steps).filter((n) => !have.has(n));
  return { fits: recipe.steps.length > 0 && missing.length === 0, missing };
}
