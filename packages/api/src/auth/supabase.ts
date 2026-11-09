import { createClient } from '@supabase/supabase-js';
import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { UserRecord } from '@librechat/data-schemas';
import type {
  CreateUserIfAbsent,
  FindBalanceByUser,
  FindUserByFields,
  GetAppConfig,
  GetBalanceConfig,
} from './provision';
import { isEmailDomainAllowed } from './domain';
import { createUserOnce } from './provision';
import { resolveAppConfigForUser, resolvePreAuthAppConfig } from '~/app/resolve';

type Dependencies = {
  url: string;
  publishableKey: string;
  getAppConfig: GetAppConfig;
  getBalanceConfig: GetBalanceConfig;
  findUser: FindUserByFields;
  createUserIfAbsent: CreateUserIfAbsent;
  findBalanceByUser: FindBalanceByUser;
  countUsers: () => Promise<number>;
  deleteAllUserSessions: (input: { userId: string }) => Promise<object>;
  registrationSchema: {
    safeParse: (body: unknown) =>
      | {
          success: true;
          data: {
            email: string;
            password: string;
            name: string;
            username?: string | null;
          };
        }
      | { success: false };
  };
};

type Credentials = { email?: string; password?: string };

type SupabaseAuthHandlers = {
  login: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
  register: (req: Request, res: Response) => Promise<Response>;
  requestPasswordReset: (req: Request, res: Response) => Promise<Response>;
  resetPassword: (req: Request, res: Response) => Promise<Response>;
};

export function createSupabaseAuthHandlers(deps: Dependencies): SupabaseAuthHandlers {
  const createAuth = () =>
    createClient(deps.url, deps.publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }).auth;
  const issuer = `${deps.url.replace(/\/+$/, '')}/auth/v1`;

  const lookup = async (id: string, email: string) => {
    const byId = await deps.findUser({ openidId: id, openidIssuer: issuer });
    if (byId) {
      return byId.email === email && byId.provider === 'supabase'
        ? { user: byId, error: null }
        : { user: null, error: 'identity_conflict' };
    }
    const byEmail = await deps.findUser({ email });
    return byEmail ? { user: null, error: 'identity_conflict' } : { user: null, error: null };
  };

  const login = async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body as Credentials;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(422).json({ message: 'Invalid credentials' });
    }
    try {
      const { data, error } = await createAuth().signInWithPassword({
        email,
        password,
      });
      if (error || !data.user?.email || !data.user.email_confirmed_at) {
        return res.status(401).json({ message: 'Invalid credentials or email not confirmed' });
      }
      const verifiedEmail = data.user.email.toLowerCase();
      const baseConfig = await resolvePreAuthAppConfig(deps.getAppConfig);
      if (!isEmailDomainAllowed(verifiedEmail, baseConfig?.registration?.allowedDomains)) {
        return res.status(403).json({ message: 'Email domain not allowed' });
      }
      const resolved = await lookup(data.user.id, verifiedEmail);
      if (resolved.error) {
        return res.status(403).json({ message: 'This email is linked to another account' });
      }
      let user: UserRecord;
      if (resolved.user) {
        user = resolved.user;
        const accountConfig = await resolveAppConfigForUser(deps.getAppConfig, user);
        if (!isEmailDomainAllowed(verifiedEmail, accountConfig?.registration?.allowedDomains)) {
          return res.status(403).json({ message: 'Email domain not allowed' });
        }
      } else {
        const username = verifiedEmail
          .split('@')[0]
          .replace(/[^a-z0-9_.]/g, '_')
          .slice(0, 80);
        const name = data.user.user_metadata?.name;
        const role = (await deps.countUsers()) === 0 ? SystemRoles.ADMIN : SystemRoles.USER;
        const created = await createUserOnce({
          strategyName: 'supabase',
          newUser: {
            provider: 'supabase',
            role,
            openidId: data.user.id,
            openidIssuer: issuer,
            email: verifiedEmail,
            emailVerified: true,
            username,
            name: typeof name === 'string' ? name : username,
          },
          email: verifiedEmail,
          lookup: () => lookup(data.user.id, verifiedEmail),
          getAppConfig: deps.getAppConfig,
          getBalanceConfig: deps.getBalanceConfig,
          createUserIfAbsent: deps.createUserIfAbsent,
          findBalanceByUser: deps.findBalanceByUser,
        });
        if (created.error || !created.user) {
          return res.status(403).json({ message: 'Account could not be created' });
        }
        user = created.user;
      }
      req.user = user as Request['user'];
      next();
    } catch (error) {
      logger.error('[supabaseLogin] Authentication service unavailable', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(503).json({ message: 'Sign-in is temporarily unavailable' });
    }
  };

  const register = async (req: Request, res: Response) => {
    const parsed = deps.registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ message: 'Invalid registration details' });
    }
    const { email, password, name, username } = parsed.data;
    try {
      const config = await resolvePreAuthAppConfig(deps.getAppConfig);
      if (!isEmailDomainAllowed(email, config?.registration?.allowedDomains)) {
        return res.status(403).json({ message: 'Email domain not allowed' });
      }
      const { error } = await createAuth().signUp({
        email,
        password,
        options: {
          data: { name, username },
          emailRedirectTo: `${process.env.DOMAIN_CLIENT}/login`,
        },
      });
      if (error) {
        logger.warn('[supabaseRegister] Registration rejected', {
          code: error.code,
        });
        return res.status(400).json({ message: 'Could not register this email' });
      }
      return res.status(200).json({
        message: 'Please check your email to verify your email address.',
        requiresEmailConfirmation: true,
      });
    } catch (error) {
      logger.error('[supabaseRegister] Authentication service unavailable', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(503).json({ message: 'Registration is temporarily unavailable' });
    }
  };

  const requestPasswordReset = async (req: Request, res: Response) => {
    const email = req.body?.email;
    if (typeof email !== 'string') {
      return res.status(422).json({ message: 'Invalid email' });
    }
    try {
      const config = await resolvePreAuthAppConfig(deps.getAppConfig);
      if (isEmailDomainAllowed(email, config?.registration?.allowedDomains)) {
        const { error } = await createAuth().resetPasswordForEmail(email, {
          redirectTo: `${process.env.DOMAIN_CLIENT}/reset-password`,
        });
        if (error) {
          logger.warn('[supabasePasswordReset] Request rejected', {
            code: error.code,
          });
        }
      }
      return res.status(200).json({ message: 'If this email exists, a reset link has been sent.' });
    } catch (error) {
      logger.error('[supabasePasswordReset] Authentication service unavailable', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(503).json({ message: 'Password reset is temporarily unavailable' });
    }
  };

  const resetPassword = async (req: Request, res: Response) => {
    const { accessToken, refreshToken, password } = req.body ?? {};
    if (
      typeof accessToken !== 'string' ||
      typeof refreshToken !== 'string' ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(422).json({ message: 'Invalid reset details' });
    }
    try {
      const recoveryAuth = createAuth();
      const { error: sessionError } = await recoveryAuth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        return res.status(400).json({ message: 'Invalid or expired reset link' });
      }
      const { data: account, error: accountError } = await recoveryAuth.getUser();
      if (accountError || !account.user?.email) {
        return res.status(400).json({ message: 'Invalid or expired reset link' });
      }
      const { error } = await recoveryAuth.updateUser({ password });
      if (error) {
        return res.status(400).json({ message: 'Password could not be reset' });
      }
      const linked = await deps.findUser({
        openidId: account.user.id,
        openidIssuer: issuer,
      });
      if (linked) {
        await deps.deleteAllUserSessions({ userId: linked._id.toString() });
      }
      await recoveryAuth.signOut({ scope: 'global' });
      return res.status(200).json({ message: 'Password changed' });
    } catch (error) {
      logger.error('[supabasePasswordReset] Authentication service unavailable', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(503).json({ message: 'Password reset is temporarily unavailable' });
    }
  };

  return { login, register, requestPasswordReset, resetPassword };
}
