import './ps5-auth.css';
import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { hasPublishedPolicies } from '~/utils/policies';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import LegalConsent from './LegalConsent';
import { Banner } from '../Banners';
import Footer from './Footer';
import { cn } from '~/utils';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const isRegister = pathname.includes('register');
  const isLogin = !pathname.includes('2fa') && pathname.includes('login');
  const showsSocialLogin = isLogin || isRegister;
  /** Both ways in state it, rather than the layout guessing which of them can
   *  create an account. That guess is not available here: account creation
   *  also happens on a first provider sign-in, on a first LDAP sign-in through
   *  the ordinary form, and is gated server-side by ALLOW_SOCIAL_REGISTRATION,
   *  which the startup payload does not carry. The sentence is about
   *  continuing, which is what both screens do, and it names the same policies
   *  the footer bar linked, so a screen states them once. */
  const hasPolicies = hasPublishedPolicies(startupConfig);
  /** Registration states it under its own submit button, where it is read
   *  before the account is created rather than below however many provider
   *  buttons a deployment configured, and it renders that form only once the
   *  config has loaded without error. The login screen has no submit button of
   *  its own to sit under, so there the layout states it below the providers,
   *  for as long as it knows the policies: a background refetch must not swap
   *  the sentence for the bar and back. */
  const registrationStatesConsent =
    isRegister && hasPolicies && !hasStartupConfigError && !isFetching;
  const statesConsentBelowProviders = isLogin && hasPolicies;
  /** The bar is dropped exactly when the sentence is on the screen, so a
   *  reader never meets both and never meets neither. */
  const statesConsent = registrationStatesConsent || statesConsentBelowProviders;
  const isTwoFactorSetup = pathname === '/login/2fa/setup';
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a
              className="text-accent-primary font-semibold hover:underline"
              href="/forgot-password"
            >
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="ps5-auth-shell bg-surface-primary relative flex min-h-screen flex-col">
      <Banner />
      <div className="ps5-auth-skyline" role="img" aria-label="Toronto skyline at sunset, PS5 PRO CHAT" />
      <div className="ps5-auth-brand">
        <svg className="ps5-auth-mark" viewBox="0 0 84 84" fill="none" aria-hidden="true">
          <rect x="7" y="16" width="62" height="48" rx="18" stroke="currentColor" strokeWidth="5" />
          <path d="M28 64 20 74V62M48 64l12 10V62" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
          <circle cx="28" cy="40" r="4" fill="currentColor" />
          <circle cx="41" cy="40" r="4" fill="currentColor" />
          <circle cx="54" cy="40" r="4" fill="currentColor" />
          <path d="M38 16V8m-5 0h10" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <div><strong>PS5 PRO CHAT</strong><small>AI · PS5 PRO · TOOLS · AUTOMATION</small></div>
      </div>
      <BlinkAnimation active={isFetching}>
        <div className="ps5-auth-original-logo mt-6 h-10 w-full bg-cover">
          <img
            src="assets/logo.svg"
            className="h-full w-full object-contain"
            alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'PS5 PRO CHAT' })}
          />
        </div>
      </BlinkAnimation>
      <DisplayError />
      <div className="absolute inset-s-0 bottom-0 md:m-4">
        <ThemeSelector />
      </div>

      <main className="flex grow items-center justify-center">
        <div
          className={cn(
            'ps5-auth-card bg-surface-primary overflow-hidden px-6 py-4 sm:rounded-lg',
            isTwoFactorSetup ? 'w-11/12 max-w-lg' : 'w-authPageWidth sm:max-w-md',
          )}
        >
          {!hasStartupConfigError && !isFetching && header && (
            <h1 className="text-text-primary mb-4 text-center text-3xl font-semibold select-none">
              {isLogin ? localize('com_auth_ps5_sign_in') : header}
            </h1>
          )}
          {children}
          {showsSocialLogin && (
            <SocialLoginRender startupConfig={startupConfig} showPasskey={isLogin} />
          )}
          {statesConsentBelowProviders && <LegalConsent startupConfig={startupConfig} />}
        </div>
      </main>
      {!statesConsent && <Footer startupConfig={startupConfig} />}
    </div>
  );
}

export default AuthLayout;
