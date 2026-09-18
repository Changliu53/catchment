/**
 * A stand-in for one `/api/query` response.
 *
 * The end-to-end test intercepts the endpoint rather than reaching the real
 * database, for two reasons. The first is practical: the database is not
 * reachable from CI, and a test that needs a network round trip to a serverless
 * Postgres is a test people start skipping. The second is the point — the
 * regression being guarded lives entirely in the browser, between "the page has
 * GeoJSON" and "the map draws something". Feeding that stretch a fixed input is
 * what makes a failure mean one thing.
 *
 * The geometry is invented, but its shape is not: three block-group-sized
 * polygons near the centre of Harris County, with the full property set the UI
 * reads, and three clearly different `pop` values so the quantile classifier
 * has something to split.
 */

type Ring = [number, number][];

/** An axis-aligned box, which is all the renderer needs to be exercised. */
function box(west: number, south: number, size: number): { type: 'Polygon'; coordinates: Ring[] } {
  const east = west + size;
  const north = south + size;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

// Eight rows, not three. A quantile classifier needs enough distinct values to
// produce class breaks at all; with three rows every break lands on the
// minimum and gets dropped, and the suite ends up asserting against a map that
// is painted one flat colour. The incomes below are spread so the legend has
// something real to divide.
const ROWS = [
  { geoid: '482010001001', west: -95.56, south: 29.74, pop: 4200, income: 41_300, flood: 0.71 },
  { geoid: '482010001002', west: -95.48, south: 29.76, pop: 2600, income: 58_900, flood: 0.55 },
  { geoid: '482010001003', west: -95.40, south: 29.78, pop: 1150, income: 92_400, flood: 0.52 },
  { geoid: '482010001004', west: -95.32, south: 29.80, pop: 3050, income: 34_800, flood: 0.63 },
  { geoid: '482010002001', west: -95.56, south: 29.86, pop: 1890, income: 71_250, flood: 0.58 },
  { geoid: '482010002002', west: -95.48, south: 29.88, pop: 5310, income: 48_600, flood: 0.84 },
  { geoid: '482010002003', west: -95.40, south: 29.90, pop: 2240, income: 112_700, flood: 0.51 },
  { geoid: '482010002004', west: -95.32, south: 29.92, pop: 960, income: 26_400, flood: 0.77 },
] as const;

const SIZE = 0.05;

export const QUERY_FIXTURE = {
  ok: true,
  source: 'preset',
  plan: {
    title: 'Flood exposure and grocery access',
    pipeline: [
      { op: 'flood_exposure', min_pct: 0.5 },
      { op: 'resource_gap', poi_type: 'supermarket', max_distance_m: 1000 },
      { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
    ],
    render: 'choropleth',
    color_by: 'pop',
  },
  totals: { blockGroups: 2830, population: 4_838_303, areaKm2: 4606, floodShare: 0.23 },
  trace: [
    { op: 'flood_exposure', remaining: 412 },
    { op: 'resource_gap', remaining: 37 },
    { op: 'rank', remaining: 3 },
  ],
  empty: false,
  comparison: null,
  matched: ROWS.length,
  matchedPopulation: ROWS.reduce((a, r) => a + r.pop, 0),
  reading: 'Fixture response used by the end-to-end test.',
  features: ROWS.map((r, i) => ({
    type: 'Feature' as const,
    geometry: box(r.west, r.south, SIZE),
    properties: {
      geoid: r.geoid,
      pop: r.pop,
      median_income: r.income,
      income_topcoded: false,
      pop_density: Math.round(r.pop / 12.4),
      flood_pct: r.flood,
      flood_pct_500: r.flood + 0.08,
      dist_grocery_m: 1400 + i * 350,
      dist_park_m: 900 + i * 220,
    },
  })),
};

/**
 * The same result, shaded by median income, with one block group whose income
 * the Census suppressed.
 *
 * This is not a hypothetical: 273 of the county's 2,830 block groups have no
 * income estimate. They used to be painted as the poorest areas on the map,
 * because `Number(null)` is 0 — and the same zeros dragged every quantile
 * break downwards, so the bug was not confined to the rows that had it.
 */
export const QUERY_FIXTURE_SUPPRESSED = {
  ...QUERY_FIXTURE,
  plan: { ...QUERY_FIXTURE.plan, title: 'Income where flooding is worst', color_by: 'median_income' },
  features: QUERY_FIXTURE.features.map((f, i) =>
    i === 0
      ? { ...f, properties: { ...f.properties, median_income: null } }
      : f,
  ),
};

/**
 * A basemap that cannot be slow, cannot be rate limited and cannot be offline.
 *
 * The real style comes from a third party. Letting the test depend on it would
 * make an unrelated outage look like a rendering regression, and would let the
 * 12-second fallback watchdog fire in the middle of an assertion.
 */
export const STUB_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f1f5f9' } }],
};
