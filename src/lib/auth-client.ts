'use client';

/**
 * The browser half of Better Auth. Only the sign-in and sign-out buttons use
 * it; everything that needs to know who is asking reads the session on the
 * server, where it cannot be lied to.
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
