/**
 * The map's structure, asserted without a map.
 *
 * Every property here was once a comment above a line of imperative setup, and
 * a comment does not fail. Two of them describe bugs that actually shipped —
 * the missing `promoteId` and the mask drawn on top — and both presented as
 * "the map looks wrong", with no error anywhere.
 */

import { describe, expect, it } from 'vitest';

import {
  DOT_HANDOFF,
  INTERACTIVE,
  LAYERS,
  lineOpacity,
  RESULT_SOURCES,
  SOURCES,
  splitFilter,
} from '@/lib/map-layers';
import { NO_DATA, RAMP } from '@/lib/ramp';

/**
 * `LayerSpecification` is a union over layer types, so `paint` and `filter`
 * are only reachable once the type is narrowed. The assertions below are about
 * what is in the object, not about which variant it is, so the lookup widens
 * once rather than narrowing at every call site.
 */
type AnyLayer = { id: string; filter?: unknown; layout?: Record<string, unknown> } & {
  paint?: Record<string, unknown>;
};

const layer = (id: string) => LAYERS.find((l) => l.id === id)! as unknown as AnyLayer;
const order = LAYERS.map((l) => l.id);

describe('sources', () => {
  it('gives both results sources a promoteId', () => {
    // Without it, `setFeatureState({ source, id })` is accepted and does
    // nothing: feature-state keys on the feature id, and GeoJSON features have
    // none unless a property is promoted into it. Hover highlighting silently
    // stops working — no error, no warning, a map that just never reacts.
    for (const id of RESULT_SOURCES) {
      expect(SOURCES[id]).toMatchObject({ type: 'geojson', promoteId: 'geoid' });
    }
  });

  it('starts the results sources empty', () => {
    // They are filled by `paint`, never at construction. That separation is
    // what lets a style swap — which destroys every source — be recovered by
    // rebuilding and refilling rather than by recreating the map.
    for (const id of RESULT_SOURCES) {
      expect((SOURCES[id] as { data: { features: unknown[] } }).data.features).toEqual([]);
    }
  });

  it('every layer points at a source that exists', () => {
    // MapLibre throws on an unknown source, but only when the layer is added,
    // which happens inside a try/catch that exists for a different reason —
    // so the throw would be swallowed and the layer would simply be absent.
    for (const l of LAYERS) {
      expect(Object.keys(SOURCES)).toContain((l as { source: string }).source);
    }
  });

  it('has no source nothing draws', () => {
    const used = new Set(LAYERS.map((l) => (l as { source: string }).source));
    expect([...Object.keys(SOURCES)].filter((s) => !used.has(s))).toEqual([]);
  });
});

describe('draw order', () => {
  it('puts the county frame underneath every result', () => {
    // The mask is translucent white over the entire world with the county cut
    // out of it. Added after the results layers it covers them, which looks
    // exactly like "the query returned nothing".
    const lastFrame = Math.max(order.indexOf('county-mask'), order.indexOf('county-outline'));
    const firstResult = Math.min(
      ...order.filter((id) => id.startsWith('results')).map((id) => order.indexOf(id)),
    );
    expect(lastFrame).toBeLessThan(firstResult);
  });

  it('draws outlines over the fill they outline', () => {
    expect(order.indexOf('results-fill')).toBeLessThan(order.indexOf('results-line'));
    expect(order.indexOf('results-fill')).toBeLessThan(order.indexOf('results-split'));
  });

  it('has no duplicate ids', () => {
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('the comparison outline', () => {
  it('is hidden and matching nothing until there is a comparison', () => {
    // Visible-with-no-filter is every block group in the county outlined in
    // amber, on first paint, before a question has been asked.
    const split = layer('results-split');
    expect(split.layout).toMatchObject({ visibility: 'none' });
    expect(split.filter).toEqual(['==', ['get', 'geoid'], '']);
  });

  it('compares numbers, not strings', () => {
    // GeoJSON properties arrive as whatever JSON held. `['>=', ['get', f], n]`
    // against a numeric string is not an error in MapLibre's evaluator — it is
    // a filter that quietly matches nothing.
    expect(splitFilter('flood_pct', 0.3)).toEqual(['>=', ['to-number', ['get', 'flood_pct']], 0.3]);
  });
});

describe('the ordinary outline', () => {
  it('fades when a comparison fills the county, and not otherwise', () => {
    const on = lineOpacity(true) as unknown[];
    const off = lineOpacity(false) as unknown[];
    expect(on.at(-1)).toBe(0.25);
    expect(off.at(-1)).toBe(0.7);
  });

  it('keeps the hovered edge at full strength either way', () => {
    // The hovered branch is the one the reader is asking about; softening it
    // with the rest would make a comparison unreadable on hover.
    for (const split of [true, false]) {
      expect((lineOpacity(split) as unknown[])[2]).toBe(1);
    }
  });
});

describe('the dot layer', () => {
  it('fades out before the polygons become legible, not after', () => {
    // Overlapping the two means dots sitting on top of the shapes they stand
    // in for, at the zoom where the shapes are the point.
    expect(DOT_HANDOFF.start).toBeLessThan(DOT_HANDOFF.end);

    const opacity = layer('results-dots').paint!['circle-opacity'] as unknown[];
    expect(opacity.at(-1)).toBe(0);
    expect(opacity.at(-2)).toBe(DOT_HANDOFF.end);
  });

  it('is one of the layers a pointer can pick from', () => {
    // On a phone the dots are frequently the only thing large enough to tap.
    expect(INTERACTIVE).toContain('results-dots');
    for (const id of INTERACTIVE) expect(order).toContain(id);
  });
});

describe('initial colours', () => {
  it('starts every shaded layer on one flat ramp colour', () => {
    // `paint` replaces these the moment there is something to shade. Before
    // that there are no breaks, and a ramp applied to no classification is a
    // map of noise that reads as meaning.
    expect(layer('results-fill').paint!['fill-color']).toBe(RAMP[1]);
    expect(layer('results-dots').paint!['circle-color']).toBe(RAMP[1]);
  });

  it('does not use the no-data grey as a starting colour', () => {
    // It means "not measured" in the legend; using it as a default would make
    // the first paint claim the county has no data.
    const colours = JSON.stringify(LAYERS);
    expect(colours).not.toContain(NO_DATA);
  });
});
