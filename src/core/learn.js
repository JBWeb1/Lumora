// Plain-language explanations of every concept Lumora shows, plus guided lessons.

export const GLOSSARY = {
  types: {
    term: 'Column types',
    short: 'What kind of information a column holds.',
    body: 'Lumora sorts every column into a type. Numbers are measurements you can do math with, like price or age. Categories are labels from a short list, like city or product. Dates are points in time. Yes/no columns are true or false. Text is free-form writing or IDs. The type decides which summaries and charts make sense.',
  },
  missing: {
    term: 'Missing values',
    short: 'Cells with no value: blank, "NA", "null" and so on.',
    body: 'Real data almost always has gaps. Lumora skips missing values when it calculates, so an average uses only the filled-in cells. If gaps are rare and random, that is fine. If they cluster (for example, every value missing in one month), they can bias your conclusions.',
  },
  mean: {
    term: 'Mean (average)',
    short: 'Add everything up and divide by how many there are.',
    body: 'The mean is the "balance point" of your numbers. It is easy to understand but sensitive to extreme values: one billionaire in a room makes the average income huge. Compare it to the median to see whether outliers are pulling it.',
  },
  median: {
    term: 'Median',
    short: 'The middle value when everything is sorted.',
    body: 'Half the values are below the median and half above. Unlike the mean, it barely moves when a few extreme values appear, which makes it a better "typical" value for skewed data like incomes or house prices.',
  },
  std: {
    term: 'Standard deviation',
    short: 'How spread out the values are around the average.',
    body: 'A small standard deviation means values sit close to the mean. A large one means they are widely scattered. For bell-shaped data, about two-thirds of values fall within one standard deviation of the mean.',
  },
  quartiles: {
    term: 'Quartiles (Q1, Q3)',
    short: 'The values 25% and 75% of the way through the sorted data.',
    body: 'Quartiles split sorted data into four equal parts. Q1 is bigger than a quarter of the values, and Q3 is bigger than three quarters. The middle half of your data sits between Q1 and Q3.',
  },
  iqr: {
    term: 'Interquartile range (IQR)',
    short: 'Q3 minus Q1: the width of the middle half of the data.',
    body: 'The IQR measures spread while ignoring the most extreme quarter on each side, so outliers do not distort it. It is also how outliers are defined.',
  },
  outlier: {
    term: 'Outlier',
    short: 'A value far away from the rest.',
    body: 'Lumora flags a value as an outlier when it lies more than 1.5 × IQR below Q1 or above Q3, the same rule box plots use. An outlier can be a typo, a measurement error or the most interesting row in your data. Investigate before you delete it.',
  },
  skewness: {
    term: 'Skewness',
    short: 'Whether values bunch up on one side with a long tail on the other.',
    body: 'Right-skewed data (positive skew) has many small values and a few very large ones, like incomes. Left-skewed data is the reverse. When skew is strong, the mean and median disagree, and the median usually describes a typical row better.',
  },
  histogram: {
    term: 'Histogram',
    short: 'Shows how a number column is distributed.',
    body: 'A histogram groups values into ranges (bins) and draws a bar for how many rows fall into each. It reveals shape: is the data symmetrical, skewed, or does it have two peaks?',
  },
  bar: {
    term: 'Bar chart',
    short: 'Compares amounts across categories.',
    body: 'Each bar is one category. Bars can show how many rows are in each category, or a summary such as the average of a number column per category. Bars start at zero, so their lengths are directly comparable.',
  },
  scatter: {
    term: 'Scatter plot',
    short: 'Shows the relationship between two number columns.',
    body: 'Each dot is one row, placed by its value on two columns. An upward-sloping cloud means the columns rise together. A downward slope means one falls as the other rises. A shapeless blob means there is little relationship.',
  },
  line: {
    term: 'Line chart',
    short: 'Shows how something changes over time.',
    body: 'Points are ordered along a time axis and joined by a line, which makes trends, seasons and sudden changes easy to spot.',
  },
  box: {
    term: 'Box plot',
    short: 'A compact summary of a distribution: median, quartiles and outliers.',
    body: 'The box spans Q1 to Q3 (the middle half of the data) and the line inside is the median. The whiskers reach the furthest values that are not outliers, and dots mark the outliers. Box plots side by side make it easy to compare groups.',
  },
  correlation: {
    term: 'Correlation (r)',
    short: 'A number from -1 to 1 measuring how closely two columns move together.',
    body: 'r = 1 means a perfect upward straight-line relationship, r = -1 a perfect downward one, and r = 0 no straight-line relationship. As a rough guide, |r| above 0.7 is strong and 0.4–0.7 is moderate. Correlation is not causation: ice cream sales and sunburns rise together because both depend on sunshine.',
  },
  trend: {
    term: 'Trend line and R²',
    short: 'The straight line that best fits a scatter plot, and how well it fits.',
    body: 'The trend line (linear regression) predicts one column from another. Its slope tells you how much Y changes, on average, when X goes up by one. R² is the share of the variation in Y the line explains: 0.8 means 80%, so the line fits well. 0.1 means it fits poorly.',
  },
  groupby: {
    term: 'Group & summarize',
    short: 'Split rows into groups and calculate a summary for each.',
    body: 'Also called a pivot table. For example, group sales by weekday and calculate the average revenue for each day. This is one of the most useful moves in data analysis: it turns thousands of rows into a small table that answers a question.',
  },
  pvalue: {
    term: 'p-value (is it real?)',
    short: 'How surprising your result would be if there were really no effect.',
    body: 'Data always has some random noise, so two groups will rarely have exactly the same average even when nothing real is going on. The p-value asks: "if there were truly no difference, how often would chance alone produce a gap at least this big?" A small p-value (below 0.05 is the usual cut-off) means chance is an unlikely explanation. It does not tell you how big or important the effect is. Look at the effect size for that. With huge datasets even tiny, unimportant differences become "significant".',
  },
  ttest: {
    term: 't-test',
    short: 'Checks whether two groups really have different averages.',
    body: "The t-test compares the gap between two group averages with how much the values vary within each group. A large gap relative to the noise gives a small p-value. Lumora uses Welch's version, which does not assume the two groups have the same spread. The confidence interval gives a plausible range for the true difference, and Cohen's d measures its size: around 0.2 is small, 0.5 medium and 0.8 large.",
  },
  anova: {
    term: 'ANOVA',
    short: 'Checks whether three or more groups really have different averages.',
    body: 'Analysis of variance (ANOVA) compares how much group averages differ from each other with how much values vary inside each group. A small p-value says at least one group differs, but not which one. η² (eta squared) is the share of all variation explained by the groups: about 0.01 is small, 0.06 medium and 0.14 large.',
  },
  chisquare: {
    term: 'Chi-square test',
    short: 'Checks whether two category columns are related.',
    body: "The chi-square test compares the counts you actually see in each combination of categories (e.g. major × passed) with the counts you would expect if the columns were unrelated. Big differences give a small p-value. Cramér's V measures how strong the association is, from 0 (none) to 1 (perfect). The test is unreliable when many combinations have fewer than 5 expected rows.",
  },
  cleaning: {
    term: 'Data cleaning',
    short: 'Fixing problems in data before analysing it.',
    body: 'Most real datasets need tidying: duplicate rows, missing values, inconsistent spelling ("NY" vs "ny "), columns with the wrong type. Every cleaning action in Lumora is recorded as a step, so you can see exactly what changed and undo it. Your original file is never modified. Be careful when filling missing values: filling with the average keeps the average the same but makes the data look less varied than it really is.',
  },
  formula: {
    term: 'Calculated column',
    short: 'A new column computed from other columns with a formula.',
    body: 'Formulas let you create the measure you actually care about: revenue per customer, profit margin, age group, weekday from a date. Refer to columns by name (use [square brackets] if the name has spaces), combine them with + − × ÷, and use functions such as round(), if() and year(). Text goes in "quotes", and & joins pieces of text together.',
  },
  filter: {
    term: 'Filters',
    short: 'Focus on the rows that matter for your question.',
    body: 'A filter keeps only rows that match a condition, such as "rainy is yes" or "revenue > 1000". All of Lumora (overview, table, charts and summaries) follows your active filters, so you can compare a subset with the whole.',
  },
};

/**
 * Guided lessons. `try` describes what to open: a sample dataset, a tab,
 * and optionally chart settings referring to columns by name.
 */
export const LESSONS = [
  {
    id: 'know',
    title: '1. Get to know your data',
    body: 'Before analysing anything, look at what each column contains and how much is missing. The Overview tab does this automatically and highlights anything that needs attention.',
    terms: ['types', 'missing'],
    try: { sample: 'coffee', tab: 'overview' },
  },
  {
    id: 'center',
    title: '2. What is typical? Mean vs median',
    body: 'Open the profile for exam_score. Compare its mean and median, then look at the histogram. A few students scored far below the rest. Can you spot them?',
    terms: ['mean', 'median', 'histogram'],
    try: { sample: 'students', tab: 'chart', chart: { type: 'histogram', x: 'exam_score' } },
  },
  {
    id: 'spread',
    title: '3. Spread and outliers',
    body: 'The box plot shows the middle half of scores as a box, with outliers as separate dots. Those dots are rows worth a closer look in the Table tab.',
    terms: ['std', 'quartiles', 'iqr', 'outlier', 'box'],
    try: { sample: 'students', tab: 'chart', chart: { type: 'box', x: 'exam_score' } },
  },
  {
    id: 'relationships',
    title: '4. Relationships between columns',
    body: 'Do hotter days sell more iced drinks? The scatter plot and trend line answer this, and R² tells you how strong the relationship is.',
    terms: ['scatter', 'correlation', 'trend'],
    try: { sample: 'coffee', tab: 'chart', chart: { type: 'scatter', x: 'temperature_c', y: 'iced_drinks' } },
  },
  {
    id: 'groups',
    title: '5. Compare groups',
    body: 'Which weekday brings the most customers? Group the rows by weekday and average the customers column.',
    terms: ['groupby', 'bar'],
    try: { sample: 'coffee', tab: 'summarize', summarize: { by: 'weekday', aggs: [{ fn: 'mean', column: 'customers' }] } },
  },
  {
    id: 'time',
    title: '6. Change over time',
    body: 'A line chart of iced drink sales by date shows the seasons. The moving average smooths out daily noise. Then add a filter for promotion = yes to see promo days only.',
    terms: ['line', 'filter'],
    try: { sample: 'coffee', tab: 'chart', chart: { type: 'line', x: 'date', y: 'iced_drinks' } },
  },
  {
    id: 'significance',
    title: '7. Is the difference real?',
    body: 'Some majors score higher than others, but could that just be luck? Below the chart, Lumora runs the right statistical test and explains the result in plain English.',
    terms: ['pvalue', 'anova', 'ttest'],
    try: { sample: 'students', tab: 'chart', chart: { type: 'box', x: 'major', y: 'exam_score' } },
  },
  {
    id: 'clean',
    title: '8. Clean data and create new columns',
    body: 'Fill the missing temperatures, then build a "revenue per customer" column with a formula. Every step is recorded, so you can undo anything.',
    terms: ['cleaning', 'formula'],
    try: { sample: 'coffee', tab: 'clean', clean: { missingCol: 'temperature_c', missingMethod: 'median', formulaName: 'revenue_per_customer', formula: 'round(revenue / customers, 2)' } },
  },
];
