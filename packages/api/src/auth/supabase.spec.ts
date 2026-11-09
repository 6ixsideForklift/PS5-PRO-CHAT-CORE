import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import type { AppConfig, UserRecord } from '@librechat/data-schemas';
import { createSupabaseAuthHandlers } from './supabase';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const email = 'brian.m@example.com';
const identity = 'supabase-user-id';
const issuer = 'https://project.supabase.co/auth/v1';
const user = {
  _id: { toString: () => 'mongo-user-id' },
  email,
  provider: 'supabase',
  role: 'ADMIN',
  openidId: identity,
  openidIssuer: issuer,
} as UserRecord;

function setup(foundById: UserRecord | null, foundByEmail: UserRecord | null = null) {
  const signInWithPassword = jest.fn().mockResolvedValue({
    data: {
      user: { id: identity, email, email_confirmed_at: '2026-11-08T00:00:00Z' },
    },
    error: null,
  });
  (createClient as jest.Mock).mockReturnValue({ auth: { signInWithPassword } });
  const findUser = jest.fn(async (query: Record<string, string | undefined>) =>
    query.openidId ? foundById : foundByEmail,
  );
  const createUserIfAbsent = jest.fn();
  const getAppConfig = jest.fn().mockResolvedValue({ registration: {} } as AppConfig);
  const handlers = createSupabaseAuthHandlers({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    getAppConfig,
    getBalanceConfig: () => null,
    findUser,
    createUserIfAbsent,
    findBalanceByUser: jest.fn(),
    countUsers: jest.fn(),
    deleteAllUserSessions: jest.fn(),
    registrationSchema: {
      safeParse: jest.fn().mockReturnValue({ success: false }),
    },
  });
  const req = { body: { email, password: 'correct-password' } } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return {
    handlers,
    req,
    res,
    next,
    findUser,
    createUserIfAbsent,
    signInWithPassword,
  };
}

beforeEach(() => jest.clearAllMocks());

it('links a confirmed Supabase identity to its existing LibreChat user', async () => {
  const { handlers, req, res, next, createUserIfAbsent } = setup(user);
  await handlers.login(req, res, next);
  expect(req.user).toBe(user);
  expect(next).toHaveBeenCalledTimes(1);
  expect(createUserIfAbsent).not.toHaveBeenCalled();
});

it('refuses an email collision with a different LibreChat identity', async () => {
  const { handlers, req, res, next, createUserIfAbsent } = setup(null, {
    ...user,
    openidId: 'another-identity',
  });
  await handlers.login(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
  expect(createUserIfAbsent).not.toHaveBeenCalled();
});
