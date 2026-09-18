import type { BlockGroup } from '../primitives.js';

/**
 * Synthetic block groups with hand-computable properties, so assertions state
 * exact expected values rather than whatever the code happens to produce.
 *
 *  geoid  pop    income   flood  grocery  park
 *  A      1000   40000    0.90    2000     300   high flood, grocery desert
 *  B      2000   80000    0.60     400     200   moderate flood, well served
 *  C       500   25000    0.10    3000    4000   low flood, both deserts
 *  D      4000  120000    0.00     150     100   no flood, dense, well served
 *  E       800     null   0.75    1500     900   income suppressed
 */
export const FIXTURE_ROWS: BlockGroup[] = [
  {
    geoid: 'A',
    pop: 1000,
    median_income: 40_000,
    area_m2: 1_000_000,
    flood_pct: 0.9,
    flood_pct_500: 0.95,
    dist_grocery_m: 2000,
    dist_park_m: 300,
    pop_density: 1000,
  },
  {
    geoid: 'B',
    pop: 2000,
    median_income: 80_000,
    area_m2: 1_000_000,
    flood_pct: 0.6,
    flood_pct_500: 0.65,
    dist_grocery_m: 400,
    dist_park_m: 200,
    pop_density: 2000,
  },
  {
    geoid: 'C',
    pop: 500,
    median_income: 25_000,
    area_m2: 500_000,
    flood_pct: 0.1,
    flood_pct_500: 0.15,
    dist_grocery_m: 3000,
    dist_park_m: 4000,
    pop_density: 1000,
  },
  {
    geoid: 'D',
    pop: 4000,
    median_income: 120_000,
    area_m2: 500_000,
    flood_pct: 0,
    flood_pct_500: 0.05,
    dist_grocery_m: 150,
    dist_park_m: 100,
    pop_density: 8000,
  },
  {
    geoid: 'E',
    pop: 800,
    median_income: null,
    area_m2: 800_000,
    flood_pct: 0.75,
    flood_pct_500: 0.80,
    dist_grocery_m: 1500,
    dist_park_m: 900,
    pop_density: 1000,
  },
];

export const ids = (rows: { geoid: string }[]) => rows.map((r) => r.geoid).sort();
