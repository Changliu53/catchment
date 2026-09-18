/**
 * Guards the packaging property that a blank map depended on.
 *
 * MapLibre does its GeoJSON-to-tile work in a Web Worker. When the worker ships
 * as a separate chunk loaded through `new Worker(new URL(...))`, that URL has
 * to survive bundling and deployment — and once it did not, the request fell
 * back to the document root, returned the 404 HTML page, and the map rendered
 * nothing. Sources, layers, paint expressions and the console all looked fine.
 *
 * A build whose worker is inlined as a Blob cannot fail that way: there is no
 * URL to resolve and no file that can 404. These tests assert that property of
 * whatever version is installed, so an upgrade that reintroduces an external
 * worker chunk fails here rather than on the deployed map.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const pkg = require('maplibre-gl/package.json') as {
  version: string;
  main?: string;
  module?: string;
};

/** The entry a bundler will actually pull in. */
function entrySource(): string {
  const entry = pkg.main ?? pkg.module;
  if (!entry) throw new Error('maplibre-gl exposes neither main nor module');
  return readFileSync(require.resolve(`maplibre-gl/${entry}`), 'utf8');
}

describe('maplibre-gl packaging', () => {
  it('creates its worker from a Blob rather than fetching a chunk', () => {
    const src = entrySource();
    expect(src).toMatch(/new Blob\(/);
    expect(src).toMatch(/new Worker\(/);
  });

  it('does not reference a separately-loaded worker file', () => {
    const src = entrySource();
    // The exact failure: an external worker URL the bundler has to carry.
    expect(src).not.toMatch(/maplibre-gl-worker[\w.-]*\.(?:m?js)/);
    expect(src).not.toMatch(/new Worker\(\s*new URL\(/);
  });

  it('is pinned to a major version whose entry is the inlined build', () => {
    const major = Number(pkg.version.split('.')[0]);
    // v6 is ESM-only and loads the worker as its own chunk. If this needs to
    // move, verify the two assertions above still hold on the new entry first.
    expect(major).toBe(5);
  });
});
