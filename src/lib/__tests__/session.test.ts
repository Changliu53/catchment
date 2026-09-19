/**
 * `viewer()` must never throw.
 *
 * Reading the session is the one call that happens on every page, which puts
 * it in the ideal position to convert any storage problem into a total outage.
 * It did exactly that once already: accounts switched themselves on in an
 * environment with no `BETTER_AUTH_SECRET`, the session read threw, and the
 * landing page — which needs no account at all — returned 500.
 *
 * This is a unit test rather than an end-to-end one, and that was a finding in
 * itself. The obvious version of this test is a server with the database
 * unplugged, but it proves nothing: `cookieCache` means an anonymous request
 * never touches the database, and a malformed cookie is rejected on its
 * signature before any query. Such a test passes whether or not the error
 * handling exists — verified by removing the handling and watching it stay
 * green — so it was deleted rather than kept for the reassurance. The failure
 * has to be injected where it actually originates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  getAuth: () => ({ api: { getSession } }),
  accountsEnabled: () => true,
  missingAuthConfig: () => [],
}));

const { viewer } = await import('@/lib/session');

beforeEach(() => {
  getSession.mockReset();
});

describe('viewer', () => {
  it('returns the signed-in person', async () => {
    getSession.mockResolvedValue({
      user: { id: 'u1', name: 'Chang', email: 'c@example.test', image: null },
    });

    expect(await viewer()).toEqual({
      id: 'u1',
      name: 'Chang',
      email: 'c@example.test',
      image: null,
    });
  });

  it('is anonymous when the session store rejects', async () => {
    // The shape of the real incident: the auth library refusing to run.
    getSession.mockRejectedValue(new Error('You are using the default secret'));

    await expect(viewer()).resolves.toBeNull();
  });

  it('is anonymous when the database is unreachable', async () => {
    getSession.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    }));

    await expect(viewer()).resolves.toBeNull();
  });

  it('is anonymous when the session table does not exist', async () => {
    getSession.mockRejectedValue(
      Object.assign(new Error('relation "session" does not exist'), { code: '42P01' }),
    );

    await expect(viewer()).resolves.toBeNull();
  });

  it('says so in the log rather than swallowing the cause', async () => {
    // Failing open is only defensible if the failure is still findable.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    getSession.mockRejectedValue(new Error('boom'));

    await viewer();

    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain('session');
    logged.mockRestore();
  });
});
