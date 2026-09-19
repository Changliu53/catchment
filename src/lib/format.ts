/**
 * Value formatting, driven by the field dictionary.
 *
 * This file used to hold two copies of knowledge that belongs in `schema.ts`:
 * a hand-maintained label map, and a switch over field names deciding units.
 * Adding a field meant editing three places, and forgetting one showed up as a
 * raw column name in a table header or an unlabelled number in the legend —
 * quietly, because nothing checks that a legend makes sense.
 *
 * Both now live on the `FieldSpec`. What is left here is the part that is
 * genuinely about presentation rather than about the field: what to show when
 * there is no value, and what to do with a name the dictionary has never heard
 * of.
 */

import { FIELDS, type FieldName } from './schema';

/**
 * Missing is not zero.
 *
 * An em dash rather than "0" or "—0—": census income suppression means the
 * value is unknown, and a table that prints a number there is making one up.
 */
export const NO_VALUE = '—';

function spec(field: string) {
  return FIELDS[field as FieldName];
}

export function formatValue(field: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_VALUE;

  // A field the dictionary does not know is a bug, but printing the raw number
  // is a better failure than throwing inside a table cell.
  return spec(field)?.format(v) ?? new Intl.NumberFormat('en-US').format(v);
}

/** Short human label for a field, for legend titles and table headers. */
export function labelFor(field: string): string {
  return spec(field)?.label ?? field;
}

/** The unit, for places that show it separately from a value. */
export function unitFor(field: string): string | null {
  return spec(field)?.unit ?? null;
}
