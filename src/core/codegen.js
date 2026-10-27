// The analysis log: every cleaning step as a readable list, or as a Python (pandas) script
// that repeats them, so others can check the work or rerun it outside Lumora.

import { describeStep } from './clean.js';

const py = (s) => JSON.stringify(String(s));
const col = (name) => `df[${py(name)}]`;
/** Put a new column right after its source column, as Lumora does. */
const insertAfter = (source, name, expr) => `df.insert(df.columns.get_loc(${py(source)}) + 1, ${py(name)}, ${expr})`;
const list = (names) => `[${names.map(py).join(', ')}]`;

const FILTER = {
  '=': (c, v) => `${c} == ${Number(v)}`,
  '≠': (c, v) => `${c} != ${Number(v)}`,
  '>': (c, v) => `${c} > ${Number(v)}`,
  '≥': (c, v) => `${c} >= ${Number(v)}`,
  '<': (c, v) => `${c} < ${Number(v)}`,
  '≤': (c, v) => `${c} <= ${Number(v)}`,
  on: (c, v) => `${c}.dt.normalize() == pd.Timestamp(${py(v)})`,
  before: (c, v) => `${c} < pd.Timestamp(${py(v)})`,
  after: (c, v) => `${c} > pd.Timestamp(${py(v)})`,
  is: (c, v) => `${c}.astype(str).str.lower() == ${py(String(v).toLowerCase())}`,
  'is not': (c, v) => `${c}.astype(str).str.lower() != ${py(String(v).toLowerCase())}`,
  contains: (c, v) => `${c}.astype(str).str.contains(${py(v)}, case=False, regex=False)`,
  'does not contain': (c, v) => `~${c}.astype(str).str.contains(${py(v)}, case=False, regex=False)`,
  'is missing': (c) => `${c}.isna()`,
  'is not missing': (c) => `${c}.notna()`,
};

const TYPES = {
  number: (c) => `pd.to_numeric(${c}.astype(str).str.replace(r"[$€£¥,%\\s]", "", regex=True), errors="coerce")`,
  date: (c) => `pd.to_datetime(${c}, errors="coerce")`,
  boolean: (c) => `${c}.astype(str).str.strip().str.lower().map({"yes": True, "y": True, "true": True, "t": True, "no": False, "n": False, "false": False, "f": False})`,
  category: (c) => `${c}.astype("category")`,
  text: (c) => `${c}.astype("string")`,
};

const DATE_PARTS = {
  year: 'dt.year',
  quarter: 'dt.quarter.map(lambda q: f"Q{q}")',
  month: 'dt.strftime("%b")',
  yearMonth: 'dt.strftime("%Y-%m")',
  weekday: 'dt.strftime("%a")',
  day: 'dt.day',
};

/** pandas code for one step (one or more lines). */
export function stepToPython(step) {
  const c = step.column != null ? col(step.column) : null;
  switch (step.op) {
    case 'removeDuplicates':
      return step.columns?.length
        ? `df = df[~df[${list(step.columns)}].astype(str).apply(lambda s: s.str.strip().str.lower()).duplicated()]`
        : 'df = df.drop_duplicates()';
    case 'dropMissing':
      return step.column == null ? 'df = df.dropna()' : `df = df.dropna(subset=[${py(step.column)}])`;
    case 'fillMissing': {
      const how = { mean: `${c}.mean()`, median: `${c}.median()`, mode: `${c}.mode()[0]`, value: py(step.value) }[step.method];
      return step.method === 'previous' ? `${c} = ${c}.ffill()` : `${c} = ${c}.fillna(${how})`;
    }
    case 'rename':
      return `df = df.rename(columns={${py(step.column)}: ${py(step.to)}})`;
    case 'delete':
      return `df = df.drop(columns=[${py(step.column)}])`;
    case 'setType':
      return `${c} = ${TYPES[step.type](c)}`;
    case 'text':
      return `${c} = ${c}.astype("string").${{ trim: 'str.strip().str.replace(r"\\s+", " ", regex=True)', lower: 'str.lower()', upper: 'str.upper()', title: 'str.title()' }[step.transform]}`;
    case 'formula':
      return `# New column ${step.name} = ${step.formula}\n# (Lumora formula: write the pandas version by hand, e.g. df["total"] = df["price"] * df["qty"])`;
    case 'keepRows':
      return `df = df[${step.filters.map((f) => `(${(FILTER[f.op] ?? (() => 'True'))(col(f.column), f.value)})`).join(' & ')}]`;
    case 'replace':
      return step.match === 'contains'
        ? `${c} = ${c}.astype("string").str.replace(${py(step.find)}, ${py(step.replace)}, case=${step.matchCase ? 'True' : 'False'}, regex=False)`
        : `${c} = ${c}.mask(${c}.astype(str).str.strip().str.lower() == ${py(String(step.find).trim().toLowerCase())}, ${py(step.replace)})`;
    case 'standardize':
      return `${c} = ${c}.replace({${Object.entries(step.map ?? {}).map(([a, b]) => `${py(a)}: ${py(b)}`).join(', ')}})`;
    case 'split':
      return `_parts = ${c}.astype("string").str.split(${py(step.by)}, expand=True)\nfor _k in reversed(range(_parts.shape[1])):\n    df.insert(df.columns.get_loc(${py(step.column)}) + 1, f"${String(step.column).replace(/[{}"\\]/g, '')} {_k + 1}", _parts[_k].str.strip())`;
    case 'group':
      return step.method === 'bins'
        ? `${insertAfter(step.column, step.name, `pd.cut(${c}, bins=range(int(${c}.min() // ${step.size ?? 10} * ${step.size ?? 10}), int(${c}.max()) + ${(step.size ?? 10) * 2}, ${step.size ?? 10}), right=False).astype(str)`)}${step.size ? '' : '  # Lumora chose the range size automatically; adjust 10 if needed'}`
        : `_top = ${c}.value_counts().index[:${step.keep}]\n${insertAfter(step.column, step.name, `${c}.where(${c}.isin(_top), "Other")`)}`;
    case 'dateParts':
      return insertAfter(step.column, step.name, `pd.to_datetime(${c}).${DATE_PARTS[step.part]}`);
    case 'segments':
      return `# Natural groups (k-means) from ${step.columns.join(', ')} into ${step.k} groups:\nfrom sklearn.cluster import KMeans\nfrom sklearn.preprocessing import StandardScaler\n_X = StandardScaler().fit_transform(df[${list(step.columns)}].fillna(df[${list(step.columns)}].median()))\ndf[${py(step.name)}] = ["Group " + str(g + 1) for g in KMeans(n_clusters=${step.k}, n_init=10, random_state=7).fit_predict(_X)]`;
    case 'unpivot':
      return `df = df.melt(id_vars=[c for c in df.columns if c not in ${list(step.columns)}], value_vars=${list(step.columns)}, var_name=${py(step.nameColumn || 'Column')}, value_name=${py(step.valueColumn || 'Value')}, ignore_index=False).sort_index(kind="stable").reset_index(drop=True)  # keep each row's values together`;
    case 'widen':
      return `df = df.pivot_table(index=${step.keys?.length ? list(step.keys) : `[c for c in df.columns if c not in [${py(step.from)}, ${py(step.values)}]]`}, columns=${py(step.from)}, values=${py(step.values)}, aggfunc="${step.combine === 'mean' ? 'mean' : 'sum'}").reset_index()`;
    case 'append':
      return `other = pd.read_csv(${py(`${step.data.name}.csv`)})  # the file that was added\ndf = pd.concat([df, other], ignore_index=True)`;
    case 'join':
      return `other = pd.read_csv(${py(`${step.data.name}.csv`)})  # the file whose columns were added\ndf = df.merge(other, left_on=${py(step.leftKey)}, right_on=${py(step.rightKey)}, how="${step.how === 'inner' ? 'inner' : step.how === 'full' ? 'outer' : 'left'}")`;
    default:
      return `# ${describeStep(step)} (no pandas equivalent written yet)`;
  }
}

export function stepsToPython(steps, fileName) {
  const lines = [
    '# Cleaning steps exported from Lumora. Run with Python 3 and pandas (pip install pandas).',
    `# Original file: ${fileName}`,
    'import pandas as pd',
    '',
    `df = pd.read_csv(${py(fileName)})`,
    '',
  ];
  steps.forEach((s, k) => lines.push(`# ${k + 1}. ${describeStep(s)}`, stepToPython(s), ''));
  lines.push(`df.to_csv(${py(fileName.replace(/(\.[^.]+)?$/, ' clean.csv'))}, index=False)`, 'print(df.head())', '');
  return lines.join('\n');
}

/** The steps as a numbered, readable list. */
export function stepsToText(steps, name) {
  return [`Cleaning steps for ${name}:`, ...steps.map((s, k) => `${k + 1}. ${describeStep(s)}`)].join('\n');
}
