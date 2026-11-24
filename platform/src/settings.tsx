import { useState } from 'react';
import type { Profile } from '../../src/platform/contracts.js';
import { api, useAction, useResource } from './api.js';
import { Icon, Notice, PageHeader } from './components.js';
import type { PlatformMeta } from './auth.js';

export function Settings({
  profile,
  refresh,
  signedOut,
}: {
  profile: Profile;
  refresh: () => void;
  signedOut: () => void;
}) {
  const action = useAction();
  const [saved, setSaved] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const meta = useResource<PlatformMeta>('/meta');
  const sessions =
    useResource<
      { id: string; token: string; createdAt: string; expiresAt: string; userAgent?: string }[]
    >('/auth/list-sessions');
  return (
    <>
      <PageHeader eyebrow="Make this space yours" title="Settings">
        Your profile, your pace, and your privacy.
      </PageHeader>
      {action.error && <Notice error>{action.error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <section className="panel">
        <h2>Profile and preferences</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void action.run(async () => {
              await api(
                '/me',
                {
                  name: data.get('name'),
                  bio: data.get('bio'),
                  timezone: data.get('timezone'),
                  dailyGoalMinutes: Number(data.get('goal')),
                  isPublic: data.has('public'),
                  leaderboard: data.has('leaderboard'),
                },
                'PUT',
              );
              setSaved('Your preferences are saved.');
              refresh();
            });
          }}
        >
          <div className="two-columns">
            <label>
              Display name
              <input name="name" maxLength={80} defaultValue={profile.name} required />
            </label>
            <label>
              Username
              <input readOnly value={profile.handle} />
              <span className="field-help">
                <a href={'/u/' + profile.handle}>View your public profile</a>
              </span>
            </label>
          </div>
          <label>
            A little about you
            <textarea name="bio" rows={2} maxLength={300} defaultValue={profile.bio} />
          </label>
          <div className="two-columns">
            <label>
              Time zone
              <input name="timezone" list="timezones" defaultValue={profile.timezone} required />
              <datalist id="timezones">
                <option value="UTC" />
                {Intl.supportedValuesOf('timeZone').map((timezone) => (
                  <option key={timezone} value={timezone} />
                ))}
              </datalist>
            </label>
            <label>
              Daily goal, in minutes
              <input
                type="number"
                name="goal"
                min={0}
                max={720}
                step={1}
                defaultValue={profile.dailyGoalMinutes}
                required
              />
              <span className="field-help">Set to 0 to turn off your daily goal.</span>
            </label>
          </div>
          <label className="check-label">
            <input type="checkbox" name="public" defaultChecked={profile.isPublic} />
            Make my profile public
            <span className="field-help">
              Only published projects contribute to public totals. Private project names and
              activity stay private.
            </span>
          </label>
          <label className="check-label">
            <input type="checkbox" name="leaderboard" defaultChecked={profile.leaderboard} />
            Include me in the community board
            <span className="field-help">
              Optional. Uses published project time for the last seven UTC days. Your profile must
              also be public.
            </span>
          </label>
          <button className="primary" disabled={action.busy}>
            Save preferences
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Password and account access</h2>
        {!meta.data?.emailEnabled && (
          <p className="small muted">
            Email recovery is not configured on this server. Keep your password safe; ask the server
            operator to configure email before relying on it for a program.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void action.run(async () => {
              await api('/auth/change-password', {
                currentPassword: data.get('current'),
                newPassword: data.get('next'),
                revokeOtherSessions: true,
              });
              form.reset();
              setSaved('Password changed. Other browser sessions have been signed out.');
              sessions.refresh();
            });
          }}
        >
          <div className="two-columns">
            <label>
              Current password
              <input type="password" name="current" autoComplete="current-password" required />
            </label>
            <label>
              New password
              <input
                type="password"
                name="next"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
          </div>
          <button disabled={action.busy}>Change password</button>
        </form>
      </section>
      <section className="panel">
        <h2>Browser sessions</h2>
        <p className="muted">
          {sessions.data?.length ?? 0} active session(s). Signing out here does not stop an editor
          device from syncing.
        </p>
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api('/auth/revoke-other-sessions', {});
              sessions.refresh();
              setSaved('Other browser sessions signed out.');
            })
          }
        >
          Sign out other browsers
        </button>
      </section>
      <section className="panel danger-zone">
        <h2>Delete your account</h2>
        <p className="muted">
          Permanently removes your projects, time records, notes, credentials, and shared reports
          from this platform. Your local collector is stored separately on your computer.
        </p>
        {deleting ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action.run(async () => {
                await api('/auth/delete-user', { password: data.get('password') });
                signedOut();
              });
            }}
          >
            <label>
              Type {profile.handle} to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label>
              Confirm with your password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <div className="actions">
              <button className="danger" disabled={action.busy || confirmation !== profile.handle}>
                Permanently delete my account
              </button>
              <button type="button" onClick={() => setDeleting(false)}>
                Keep my account
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setDeleting(true)}>Delete account</button>
        )}
      </section>
    </>
  );
}
