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

const ROWS = [
  { geoid: '482010001001', west: -95.52, south: 29.78, pop: 4200, income: 41_300, flood: 0.71 },
  { geoid: '482010001002', west: -95.44, south: 29.80, pop: 2600, income: 58_900, flood: 0.55 },
  { geoid: '482010001003', west: -95.36, south: 29.82, pop: 1150, income: 92_400, flood: 0.52 },
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
