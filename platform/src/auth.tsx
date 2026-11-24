import { useState } from 'react';
import { api, useAction, useResource } from './api.js';
import { Icon, Notice } from './components.js';

export interface PlatformMeta {
  emailEnabled: boolean;
  registrationOpen: boolean;
  extensionAvailable: boolean;
}
export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const token = new URLSearchParams(location.search).get('token');
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>(
    location.pathname === '/reset-password' && token ? 'reset' : 'signin',
  );
  const [sent, setSent] = useState(false);
  const meta = useResource<PlatformMeta>('/meta');
  const action = useAction();
  const title = {
    signin: 'Welcome back.',
    signup: 'Make room for your next idea.',
    forgot: 'Find your way back.',
    reset: 'A fresh password.',
  }[mode];
  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    await action.run(async () => {
      if (mode === 'forgot') {
        await api('/auth/request-password-reset', {
          email: data.get('email'),
          redirectTo: location.origin + '/reset-password',
        });
        setSent(true);
        return;
      }
      if (mode === 'reset') {
        await api('/auth/reset-password', { token, newPassword: data.get('password') });
        history.replaceState({}, '', '/');
        setMode('signin');
        setSent(true);
        return;
      }
      const input = {
        email: data.get('email'),
        password: data.get('password'),
        callbackURL:
          location.origin +
          (location.pathname === '/connect' ? location.pathname + location.search : '/'),
        ...(mode === 'signup' ? { name: data.get('name'), username: data.get('username') } : {}),
      };
      await api('/auth/' + (mode === 'signup' ? 'sign-up' : 'sign-in') + '/email', input);
      if (mode === 'signup' && meta.data?.emailEnabled) {
        setSent(true);
        return;
      }
      onSignedIn();
    });
  }
  function switchMode(next: typeof mode) {
    setMode(next);
    setSent(false);
    action.clearError();
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          HackTrail
        </a>
        <div>
          <p className="eyebrow">For the things you make</p>
          <h1>
            Small steps.
            <br />A trail worth keeping.
          </h1>
          <p>
            See where your time goes, keep your projects moving, and share the work behind the
            finished thing.
          </p>
          <ol className="story-trail">
            <li>
              <span>01</span>
              <div>
                <strong>Work in your editor</strong>
                <p>Your local tracker handles the clock.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>See the whole picture</strong>
                <p>Editor activity, agent runs, and Git context.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Share on your terms</strong>
                <p>Choose what belongs in a public project or report.</p>
              </div>
            </li>
          </ol>
        </div>
        <p className="small">Open source. Built for builders.</p>
      </section>
      <main className="auth-form">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {mode === 'signup'
              ? 'A simple home for your projects and progress.'
              : mode === 'signin'
                ? 'Your projects are waiting right where you left them.'
                : 'Use the email address connected to your account.'}
          </p>
          {action.error && <Notice error>{action.error}</Notice>}
          {sent && (
            <Notice>
              {mode === 'signup'
                ? 'Check your inbox to verify your email and finish creating your account.'
                : mode === 'forgot'
                  ? 'If the account exists, a reset link has been sent.'
                  : 'Password updated. You can now sign in.'}
            </Notice>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(event.currentTarget);
            }}
          >
            {mode === 'signup' && (
              <>
                <label>
                  Your name
                  <input name="name" autoComplete="name" maxLength={80} required />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    aria-label="Username"
                    aria-describedby="username-help"
                    autoComplete="username"
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{2,31}"
                    minLength={3}
                    maxLength={32}
                    required
                  />
                  <span className="field-help" id="username-help">
                    Letters, numbers, underscores, and hyphens.
                  </span>
                </label>
              </>
            )}
            {mode !== 'reset' && (
              <label>
                Email
                <input type="email" name="email" autoComplete="email" maxLength={254} required />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  aria-label="Password"
                  aria-describedby={mode === 'signin' ? undefined : 'password-help'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signin' ? 1 : 12}
                  maxLength={128}
                  required
                />
                {mode !== 'signin' && (
                  <span className="field-help" id="password-help">
                    At least 12 characters.
                  </span>
                )}
              </label>
            )}
            {mode === 'signup' && (
              <p className="small muted">
                Your name and username start public. Synced projects start private. You can change
                profile visibility in Settings.
              </p>
            )}
            <button
              className="primary full-width"
              disabled={action.busy || (mode === 'signup' && meta.data?.registrationOpen === false)}
            >
              {action.busy
                ? 'Please wait...'
                : {
                    signin: 'Sign in',
                    signup: 'Create account',
                    forgot: 'Send reset link',
                    reset: 'Update password',
                  }[mode]}
              <Icon name="arrow" />
            </button>
          </form>
          {mode === 'signin' ? (
            <div className="auth-links">
              {meta.data?.registrationOpen !== false && (
                <button className="text-button" onClick={() => switchMode('signup')}>
                  New here? Create an account
                </button>
              )}
              {meta.data?.emailEnabled && (
                <button className="text-button" onClick={() => switchMode('forgot')}>
                  Forgot your password?
                </button>
              )}
            </div>
          ) : (
            <button className="text-button" onClick={() => switchMode('signin')}>
              Back to sign in
            </button>
          )}
          <a
            className="small muted auth-source"
            href="https://github.com/Swamstick911/HackTrail"
            target="_blank"
            rel="noreferrer"
          >
            View the source on GitHub
          </a>
        </div>
      </main>
    </div>
  );
}
