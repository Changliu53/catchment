/**
 * Data access. One place, so the SQL that touches geometry is auditable.
 *
 * Two rules hold everywhere in this file:
 *
 *  1. Measurement uses `geom` transformed to EPSG:32615. `geom_simple` is
 *     returned to the browser for drawing and is never measured against.
 *  2. Nothing here interpolates user input into SQL. The executor filters rows
 *     in TypeScript over a fully materialised dataset; these queries take no
 *     parameters from the request at all.
 *
 * The dataset is 2,830 rows and changes only when the pipeline is re-run, so
 * it is fetched once per server instance and kept in memory. That removes the
 * database from the hot path entirely — a cold Neon compute costs nothing on a
 * request because no request touches it.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { neon } from '@neondatabase/serverless';

import type { BlockGroup } from './primitives';

export interface BlockGroupFeature extends BlockGroup {
  /** GeoJSON geometry, simplified. Display only. */
  geometry: unknown;
}

let cache: Promise<BlockGroupFeature[]> | null = null;

/**
 * A second data source, for running with no database at all.
 *
 * Opt-in through an environment variable rather than a fallback: silently
 * serving sample data because a connection string was missing is exactly the
 * kind of thing that reaches production and is believed. Set
 * `CATCHMENT_DATA=fixture` and it reads `fixtures/block-groups.json` — a
 * stratified sample of the real table, cut by `pipeline/make_fixture.py`.
 *
 * This is what lets the end-to-end suite run in CI, and lets anyone who clones
 * the repository see the real thing without Neon credentials. Once the page
 * renders on the server, tests can no longer intercept an HTTP call the
 * browser no longer makes, so the data has to be swappable underneath instead.
 */
const FIXTURE_PATH = join(process.cwd(), 'fixtures', 'block-groups.json');

function usingFixture(): boolean {
  return process.env.CATCHMENT_DATA === 'fixture';
}

async function fetchFixture(): Promise<BlockGroupFeature[]> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as BlockGroupFeature[];
}

function connection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

async function fetchAll(): Promise<BlockGroupFeature[]> {
  if (usingFixture()) return fetchFixture();

  const sql = connection();

  const rows = await sql`
    SELECT
      geoid,
      pop,
      median_income,
      income_topcoded,
      area_m2,
      pop_density,
      flood_pct,
      flood_pct_500,
      dist_grocery_m,
      dist_park_m,
      ST_AsGeoJSON(geom_simple, 6) AS geometry
    FROM block_groups
    ORDER BY geoid
  `;

  return rows.map((r) => ({
    geoid: r.geoid as string,
    pop: Number(r.pop),
    median_income: r.median_income === null ? null : Number(r.median_income),
    income_topcoded: Boolean(r.income_topcoded),
    area_m2: Number(r.area_m2),
    pop_density: Number(r.pop_density),
    flood_pct: Number(r.flood_pct),
    flood_pct_500: Number(r.flood_pct_500),
    dist_grocery_m: Number(r.dist_grocery_m),
    dist_park_m: Number(r.dist_park_m),
    geometry: JSON.parse(r.geometry as string),
  })) as BlockGroupFeature[];
}

/** Memoised for the life of the server instance. */
export function loadBlockGroups(): Promise<BlockGroupFeature[]> {
  cache ??= fetchAll().catch((err) => {
    cache = null; // let the next request retry rather than caching the failure
    throw err;
  });
  return cache;
}

/**
 * County-wide context shown alongside every result, so a number like "317
 * block groups" is never presented without its denominator.
 */
export async function countyTotals() {
  const rows = await loadBlockGroups();
  const area = rows.reduce((a, r) => a + r.area_m2, 0);
  return {
    blockGroups: rows.length,
    population: rows.reduce((a, r) => a + r.pop, 0),
    areaKm2: area / 1e6,
    floodShare: rows.reduce((a, r) => a + r.flood_pct * r.area_m2, 0) / area,
  };
}
