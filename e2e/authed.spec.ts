/**
 * Save, share, rename, delete — signed in, against a real database.
 *
 * This is the flow with something at stake, and until now it was the one flow
 * with no end-to-end coverage at all. The authorization rules underneath it
 * are tested directly (`saved.integration.test.ts`), but nothing exercised the
 * path a person actually takes: press Save, land on a share link, see it in
 * your list, rename it, delete it. Three separate faults this week lived in
 * exactly that gap between "the parts are tested" and "the thing works".
 *
 * Signing in is faked rather than performed. Real GitHub OAuth needs a
 * registered application and a third party's consent screen, which is not
 * something a test suite should depend on — so the session is created the way
 * the server would create it: a row in `session`, and a cookie signed with the
 * same secret the server was started with. Everything after that point is the
 * real application: real Server Actions, real queries, real redirects.
 *
 * What this therefore does *not* cover is the OAuth round trip itself. That is
 * stated rather than glossed, because a test that looks like it covers sign-in
 * and does not is worse than one that admits the boundary.
 */

import { expect, test, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { Pool } from 'pg';

import { E2E_AUTH_SECRET, E2E_DATABASE_URL, E2E_USER } from './authed-env';
import { stubBasemap } from './helpers';

const db = new Pool({ connectionString: E2E_DATABASE_URL ?? undefined });

/**
 * How long to wait for a share route to be on screen.
 *
 * `/a/[slug]` renders the whole analysis before it sends a byte — there is no
 * Suspense boundary above it, deliberately, so that the page works with
 * JavaScript switched off (docs/decisions/0004). The cost of that choice is
 * paid here: the URL can be current while the document is not, and the 5s
 * default assertion timeout turns into an accidental performance budget on a
 * blocking server render that is sharing a CI runner with a Postgres
 * container and four Next servers.
 *
 * It went flaky exactly once, on a dependency-update run, and was green on the
 * retry. Given explicitly rather than inherited, because what this suite is
 * asserting is that the share page shows the saved analysis — not how many
 * seconds that takes. A real regression still fails; it just fails on being
 * wrong rather than on being slow.
 */
const SHARE_ROUTE_TIMEOUT = 20_000;

test.beforeAll(async () => {
  // Start from nothing: the cascade on `user` takes any saved rows with it,
  // which also means a previous run cannot leave a row that makes this one
  // pass.
  await db.query('delete from "user" where id = $1', [E2E_USER.id]);
  await db.query(
    'insert into "user" (id, name, email, email_verified, updated_at) values ($1, $2, $3, true, now())',
    [E2E_USER.id, E2E_USER.name, E2E_USER.email],
  );
  await db.query(
    `insert into session (id, expires_at, token, updated_at, user_id)
     values ($1, now() + interval '1 day', $2, now(), $3)`,
    [E2E_USER.sessionId, E2E_USER.sessionToken, E2E_USER.id],
  );
});

test.afterAll(async () => {
  await db.query('delete from "user" where id = $1', [E2E_USER.id]);
  await db.end();
});

/** The cookie the server would have set, signed the way it signs it. */
async function signIn(context: BrowserContext, port: number) {
  const signature = await makeSignature(E2E_USER.sessionToken, E2E_AUTH_SECRET);
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: `${E2E_USER.sessionToken}.${signature}`,
      domain: '127.0.0.1',
      path: '/',
    },
  ]);
  return port;
}

test.beforeEach(async ({ context, baseURL, page }) => {
  await signIn(context, Number(new URL(baseURL!).port));
  await stubBasemap(page);
});

test('the session is read on the server, not asserted by the client', async ({ page }) => {
  await page.goto('/');

  // Proof the cookie is doing what a real sign-in would: the page comes back
  // already knowing who is asking, before any script runs.
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /^saved$/i })).toBeVisible();
});

test('save, share, rename, delete', async ({ page }) => {
  await page.goto('/?preset=flooded-grocery-deserts');
  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();

  // --- save -------------------------------------------------------------
  const title = page.getByLabel('Name for this analysis');
  await expect(title).toBeVisible();
  await title.fill('Grocery deserts to revisit');
  await page.getByRole('button', { name: /^save$/i }).click();

  // Saving lands on the share link itself, because that link is the thing
  // being made — not back on the map with a toast to go hunting for.
  await page.waitForURL(/\/a\/[a-z0-9]+$/);
  const shareUrl = page.url();
  const slug = shareUrl.split('/a/')[1]!;

  await expect(page.getByText('Saved analysis')).toBeVisible({ timeout: SHARE_ROUTE_TIMEOUT });
  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();

  // --- the link is public ------------------------------------------------
  const stranger = await page.context().browser()!.newContext();
  try {
    const anonymous = await stranger.newPage();
    await stubBasemap(anonymous);
    await anonymous.goto(shareUrl);

    // Readable without an account — that is what makes it a share link.
    await expect(anonymous.getByText('Grocery deserts to revisit')).toBeVisible({
      timeout: SHARE_ROUTE_TIMEOUT,
    });
    await expect(anonymous.getByText(/someone shared this/i)).toBeVisible();
    // And a stranger is offered no way to change it.
    await expect(anonymous.getByRole('button', { name: /rename/i })).toHaveCount(0);
    await expect(anonymous.getByText(/delete this analysis/i)).toHaveCount(0);
  } finally {
    await stranger.close();
  }

  // --- it appears in the list -------------------------------------------
  await page.goto('/saved');
  const row = page.locator('li', { hasText: 'Grocery deserts to revisit' });
  await expect(row).toBeVisible();
  // The question, not the URL parameters.
  await expect(row).toContainText('Which flood-exposed neighbourhoods have no supermarket');
  await expect(row).not.toContainText('%20');

  // --- rename ------------------------------------------------------------
  await page.goto(`/a/${slug}`);
  const name = page.getByLabel('Analysis name');
  await name.fill('Renamed from the share page');
  await page.getByRole('button', { name: /rename/i }).click();
  await page.waitForURL(new RegExp(`/a/${slug}$`));

  await page.goto('/saved');
  await expect(page.getByText('Renamed from the share page')).toBeVisible();

  // --- delete ------------------------------------------------------------
  // Two steps on purpose; the first only opens the confirmation.
  await page.getByRole('group').filter({ hasText: 'Delete' }).first().click();
  await page.getByRole('button', { name: /^delete$/i }).click();
  await page.waitForURL(/\/saved$/);

  await expect(page.getByText('Renamed from the share page')).toHaveCount(0);

  // Gone from the database, not merely hidden from the list.
  const { rows } = await db.query('select 1 from saved_analysis where slug = $1', [slug]);
  expect(rows).toHaveLength(0);

  // And the share link stops working, rather than 500ing on a missing row.
  expect((await page.request.get(`/a/${slug}`)).status()).toBe(404);
});

test('a stranger is offered nothing, and the row survives their visit', async ({ page }) => {
  // Deliberately narrower than it could sound: this asserts what the interface
  // offers someone else and that reading does not destroy anything. Whether a
  // *request* forged without the button is refused is a claim about the WHERE
  // clause, and it is made where it can actually be proved — against a real
  // Postgres, in `saved.integration.test.ts`.
  await page.goto('/?preset=densest');
  await page.getByLabel('Name for this analysis').fill('Mine');
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForURL(/\/a\/[a-z0-9]+$/);
  const slug = page.url().split('/a/')[1]!;

  // Someone else's session, posting this slug.
  await db.query('delete from "user" where id = $1', ['e2e-stranger']);
  await db.query(
    'insert into "user" (id, name, email, email_verified, updated_at) values ($1, $2, $3, true, now())',
    ['e2e-stranger', 'Stranger', 'e2e-stranger@example.test'],
  );
  await db.query(
    `insert into session (id, expires_at, token, updated_at, user_id)
     values ($1, now() + interval '1 day', $2, now(), $3)`,
    ['e2e-stranger-session', 'e2e-stranger-token', 'e2e-stranger'],
  );

  const other = await page.context().browser()!.newContext();
  try {
    const signature = await makeSignature('e2e-stranger-token', E2E_AUTH_SECRET);
    await other.addCookies([
      {
        name: 'better-auth.session_token',
        value: `e2e-stranger-token.${signature}`,
        domain: '127.0.0.1',
        path: '/',
      },
    ]);

    const theirs = await other.newPage();
    await stubBasemap(theirs);
    await theirs.goto(`/a/${slug}`);

    // They can read it — it is a share link — but they are offered nothing,
    // and the row is still there afterwards.
    await expect(theirs.getByText(/someone shared this/i)).toBeVisible({
      timeout: SHARE_ROUTE_TIMEOUT,
    });
    await expect(theirs.getByRole('button', { name: /rename/i })).toHaveCount(0);
  } finally {
    await other.close();
    await db.query('delete from "user" where id = $1', ['e2e-stranger']);
  }

  const { rows } = await db.query('select 1 from saved_analysis where slug = $1', [slug]);
  expect(rows, 'the row a stranger looked at should still exist').toHaveLength(1);
});
