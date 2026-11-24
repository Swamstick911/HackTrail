import { useState } from 'react';
import type { CredentialScope } from '../../src/platform/contracts.js';
import { api, useAction, useResource } from './api.js';
import { Empty, Icon, Loading, Notice, PageHeader } from './components.js';
import type { PlatformMeta } from './auth.js';

interface DeviceKey {
  id: string;
  label: string;
  prefix: string;
  scopes: CredentialScope[];
  createdAt: string;
  lastUsedAt: string | null;
}
export function Connections() {
  const resource = useResource<DeviceKey[]>('/keys', 30_000);
  const meta = useResource<PlatformMeta>('/meta');
  const action = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const editorLink =
    'vscode://swamstick911.hacktrail/account?origin=' + encodeURIComponent(location.origin);
  return (
    <>
      <PageHeader eyebrow="Make it part of your workflow" title="Connect your tools">
        Set it up once. Get back to making things.
      </PageHeader>
      {(resource.error || action.error) && (
        <Notice error>{resource.error?.message || action.error}</Notice>
      )}
      <section className="connection-card panel">
        <span className="connection-icon">
          <Icon name="code" width={32} height={32} />
        </span>
        <div>
          <span className="eyebrow">Start here</span>
          <h2>VS Code</h2>
          <p className="muted">
            Automatic idle detection, an offline queue, and optional Git, Claude Code, and Codex
            activity.
          </p>
          <ol className="plain-list numbered">
            <li>
              Install the HackTrail VSIX using <strong>Extensions: Install from VSIX</strong>.
            </li>
            <li>Open your project and choose what to collect.</li>
            <li>Connect your account, then approve the browser code.</li>
          </ol>
          <div className="actions">
            {meta.data?.extensionAvailable ? (
              <a className="button primary" href="/api/integrations/vscode">
                <Icon name="download" />
                Download extension
              </a>
            ) : (
              <p className="small muted">
                The server operator needs to build the extension package.
              </p>
            )}
            <a className="button" href={editorLink}>
              Connect installed extension
            </a>
          </div>
          <p className="small muted">
            You can also run <strong>HackTrail: Connect Account</strong> in the Command Palette. New
            projects start private. No prompt text or source code is uploaded.
          </p>
        </div>
      </section>
      <section className="panel">
        <h2>Other editors through WakaTime</h2>
        <p className="muted">
          Use a plugin that supports a custom API endpoint. This compatibility endpoint estimates
          time between heartbeats up to two minutes apart; its totals can differ from direct editor
          tracking.
        </p>
        <p className="small">
          Create a write-only key below, then use these settings in <code>~/.wakatime.cfg</code>.
          Keep your existing provider configuration backed up.
        </p>
        <pre>
          <code>
            {'[settings]\napi_url = ' + location.origin + '/api/v1\napi_key = YOUR_HACKTRAIL_KEY'}
          </code>
        </pre>
        <p className="small muted">
          The receiver accepts project, language, editor, and timestamp metadata. Incoming file
          paths and source content are not retained. Agent hooks require the HackTrail extension.
          Compatibility is tested at the API boundary; individual plugins still need real-device
          validation.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Devices and API keys</h2>
            <p className="small muted">Remove access without changing your password.</p>
          </div>
        </div>
        {resource.loading && <Loading />}
        {resource.data?.length ? (
          <ul className="key-list">
            {resource.data.map((key) => (
              <li key={key.id}>
                <span className="project-symbol">
                  <Icon name="connect" />
                </span>
                <div>
                  <strong>{key.label}</strong>
                  <span className="small muted block">
                    {key.scopes.join(', ')} ·{' '}
                    {key.lastUsedAt
                      ? 'Last used ' + new Date(key.lastUsedAt).toLocaleString()
                      : 'Not used yet'}
                  </span>
                  <code className="small">{key.prefix}...</code>
                </div>
                {confirm === key.id ? (
                  <div className="actions">
                    <button
                      className="danger"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api('/keys/' + key.id, undefined, 'DELETE');
                          resource.refresh();
                          setConfirm(null);
                        })
                      }
                    >
                      Confirm revoke
                    </button>
                    <button onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirm(key.id)}>Revoke</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No devices connected yet">
            Approve your editor in the browser to see it here.
          </Empty>
        )}
        <details>
          <summary>Create an API key</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action.run(async () => {
                const result = await api<{ token: string }>('/keys', {
                  label: data.get('label'),
                  scopes: [data.get('scope')],
                });
                setSecret(result.token);
                resource.refresh();
              });
            }}
          >
            <label>
              Key name
              <input name="label" maxLength={80} placeholder="My Neovim plugin" required />
            </label>
            <label>
              Permission
              <select name="scope">
                <option value="write:activity">Send activity only</option>
                <option value="read:stats">Read my project statistics only</option>
              </select>
            </label>
            <button disabled={action.busy}>Create key</button>
          </form>
        </details>
        {secret && (
          <Notice>
            <strong>Save this key now. It is shown only once.</strong>
            <label>
              New API key
              <input
                className="secret-input"
                aria-label="New API key"
                readOnly
                value={secret}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <button onClick={() => setSecret(null)}>I have saved it</button>
          </Notice>
        )}
      </section>
    </>
  );
}
export function DeviceApproval() {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [selected, setSelected] = useState(code);
  const device = useResource<{ label: string; expiresAt: string; approved: boolean }>(
    selected ? '/devices/' + encodeURIComponent(selected) : null,
  );
  const action = useAction();
  const [approved, setApproved] = useState(false);
  return (
    <div className="narrow">
      <PageHeader eyebrow="One last step" title="Connect this editor">
        Only approve a code that you just opened from your editor.
      </PageHeader>
      {(device.error || action.error) && (
        <Notice error>{device.error?.message || action.error}</Notice>
      )}
      {approved || device.data?.approved ? (
        <section className="panel">
          <span className="success-mark">
            <Icon name="check" width={32} height={32} />
          </span>
          <h2>You are connected.</h2>
          <p className="muted">
            Return to your editor. It will finish setup and start syncing your selected activity.
          </p>
          <a className="button" href="/">
            Open your dashboard
          </a>
        </section>
      ) : (
        <section className="panel">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSelected(code.trim().toUpperCase());
            }}
          >
            <label>
              Connection code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={10}
                pattern="[A-Fa-f0-9]{10}"
                required
                autoComplete="off"
              />
            </label>
            <button>Check code</button>
          </form>
          {device.loading && <Loading />}
          {device.data && (
            <div className="device-approval">
              <p className="eyebrow">{selected}</p>
              <h2>{device.data.label}</h2>
              <p className="muted">
                This device can send activity to your account. It cannot manage your profile, change
                project privacy, or read your records.
              </p>
              <p className="small muted">
                Expires {new Date(device.data.expiresAt).toLocaleTimeString()}.
              </p>
              <button
                className="primary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api('/devices/' + encodeURIComponent(selected) + '/approve', {});
                    setApproved(true);
                  })
                }
              >
                Approve connection
                <Icon name="check" />
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
