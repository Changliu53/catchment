/**
 * Value formatting, driven by the field dictionary.
 *
 * Units live in `schema.ts`; this is the one place that turns them into text.
 * A legend without units is decoration, and a number whose unit the reader has
 * to infer is worse than no number.
 */

import { FIELDS, type FieldName } from './schema';

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatValue(field: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';

  switch (field) {
    case 'flood_pct':
    case 'flood_pct_500':
      return `${oneDp.format(v * 100)}%`;
    case 'median_income':
      return `$${int.format(v)}`;
    case 'dist_grocery_m':
    case 'dist_park_m':
      return v >= 1000 ? `${oneDp.format(v / 1000)} km` : `${int.format(v)} m`;
    case 'area_m2':
      return `${oneDp.format(v / 1e6)} km²`;
    case 'pop_density':
      return `${int.format(v)}/km²`;
    case 'pop':
      return int.format(v);
    default:
      return int.format(v);
  }
}

/** Short human label for a field, for legend titles and table headers. */
export function labelFor(field: string): string {
  const labels: Record<string, string> = {
    pop: 'Population',
    median_income: 'Median household income',
    pop_density: 'Population density',
    flood_pct: 'Area in the 100-year floodplain',
    flood_pct_500: 'Area in the 0.2% annual chance zone',
    dist_grocery_m: 'Distance to nearest supermarket',
    dist_park_m: 'Distance to nearest park',
    area_m2: 'Area',
  };
  return labels[field] ?? (FIELDS[field as FieldName]?.name ?? field);
}
