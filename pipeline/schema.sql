-- The block-group table the application reads (src/lib/db.ts) and
-- load_postgis.py fills. Kept here, next to the loader, because it is the
-- pipeline's output rather than something the app's migrations own: the
-- Drizzle schema in src/db/ only covers accounts and saved analyses.
--
-- Safe to run against a database that already has the table. load_postgis.py
-- runs it before every load, so a fresh database needs nothing else.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS block_groups (
  geoid           char(12) PRIMARY KEY,
  pop             integer NOT NULL,
  -- Null where the Census suppressed the estimate. Unknown, not zero.
  median_income   integer,
  income_topcoded boolean NOT NULL DEFAULT false,
  area_m2         double precision NOT NULL,
  pop_density     double precision NOT NULL,
  flood_pct       double precision NOT NULL CHECK (flood_pct BETWEEN 0 AND 1),
  flood_pct_500   double precision NOT NULL CHECK (flood_pct_500 BETWEEN 0 AND 1),
  dist_grocery_m  double precision NOT NULL,
  dist_park_m     double precision NOT NULL,
  -- Full precision, for measurement only.
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  -- Simplified at 10 m, for drawing only. Never measured against.
  geom_simple     geometry(MultiPolygon, 4326) NOT NULL
);
