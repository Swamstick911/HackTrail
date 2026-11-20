import { useEffect, useState } from 'react';
import type { Project } from '../../src/shared/events.js';
import { api, downloadExtension, errorMessage } from './api.js';
import { Dialog } from './dialogs.js';
import { Icon } from './icons.js';

export function ConnectionsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [tab, setTab] = useState<'editor' | 'claude'>('editor');
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const command =
    'npm run connect:claude -- --project ' + project.id + ' --workspace "YOUR_PROJECT_FOLDER"';
  useEffect(() => {
    void api<{ editorDownloadAvailable: boolean }>('/integrations')
      .then((result) => setAvailable(result.editorDownloadAvailable))
      .catch((error) => setError(errorMessage(error)));
  }, []);

  async function download() {
    setBusy(true);
    try {
      await downloadExtension();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Connect your tools" onClose={onClose} busy={busy}>
      <p className="muted">
        Bring live activity into <strong>{project.name}</strong>.
      </p>
      <div className="segmented" aria-label="Connection type">
        <button aria-pressed={tab === 'editor'} onClick={() => setTab('editor')}>
          VS Code
        </button>
        <button aria-pressed={tab === 'claude'} onClick={() => setTab('claude')}>
          Claude Code
        </button>
      </div>
      {project.isExample ? (
        <p className="callout">
          This is an example. Create your own project before connecting an editor.
        </p>
      ) : tab === 'editor' ? (
        <>
          <div className="connection-intro">
            <span className="tool-symbol editor">
              <Icon name="code" />
            </span>
            <div>
              <h3>Your editor does the tracking.</h3>
              <p>Install once, connect this workspace, and keep working.</p>
            </div>
          </div>
          <ol className="setup-steps">
            <li>Download the extension below.</li>
            <li>
              In VS Code, open the command palette and run{' '}
              <strong>Extensions: Install from VSIX</strong>. Select the downloaded file.
            </li>
            <li>
              Open your project folder. Run <strong>HackTrail: Connect This Workspace</strong>, then
              select <strong>{project.name}</strong>.
            </li>
          </ol>
          <p className="small muted">
            Keep HackTrail running. Only activity timestamps are sent; code and file names stay out
            of the tracker. The extension also works in compatible Cursor versions.
          </p>
          <button
            className="primary full-width"
            disabled={busy || !available}
            onClick={() => void download()}
          >
            <Icon name="download" />
            {busy ? 'Preparing download...' : 'Download VS Code extension'}
          </button>
          {!available && (
            <p className="small muted">
              The extension package is not built yet. Run <code>npm run package:extension</code> in
              HackTrail, then reopen this dialog.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="connection-intro">
            <span className="tool-symbol claude">
              <Icon name="activity" />
            </span>
            <div>
              <h3>Keep agent work in the picture.</h3>
              <p>Prompts, tool events, and agent runtime appear live.</p>
            </div>
          </div>
          <p>
            From the HackTrail terminal, run this command. Replace <code>YOUR_PROJECT_FOLDER</code>{' '}
            with the folder where you use Claude Code.
          </p>
          <pre className="command-block">{command}</pre>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(command)
                .then(() => setCopied(true))
                .catch(() => setError('Select and copy the command above.'));
            }}
          >
            {copied ? 'Copied' : 'Copy command'}
          </button>
          <p className="small muted">
            This adds local hooks and keeps your existing Claude settings. Restart Claude afterward.
            Hooks collect event metadata without saving prompts, code, or tool output.
          </p>
          <p className="small muted">
            Agent runtime is shown separately from your editor time. Pending events retry on the
            next hook when the collector is back.
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function TimePolicyDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="How time is counted" onClose={onClose}>
      <p>
        HackTrail estimates time spent interacting with your editor. It is a useful record, not
        proof of human work.
      </p>
      <dl className="policy-list">
        <dt>Starts with your input</dt>
        <dd>
          Keyboard and mouse selection signals in the connected workspace start an activity window.
          Opening a window or an automated file edit does not.
        </dd>
        <dt>Stops when you leave</dt>
        <dd>
          Switching away stops the clock. After 2 minutes without input, the activity window
          expires. Sleep gaps longer than 30 seconds are skipped.
        </dd>
        <dt>Updates every 15 seconds</dt>
        <dd>
          The dashboard shows saved time, so the number moves in small steps. Overlapping windows
          count once. The first accepted project gets overlapping time.
        </dd>
        <dt>Agent work stays separate</dt>
        <dd>
          Claude runtime comes from paired live start and stop hooks. It is never added to editor
          time. Interrupted or unmatched runs are marked for review.
        </dd>
        <dt>Some work cannot be observed</dt>
        <dd>
          Reading, planning, terminal use, and testing outside the editor may be missed. Add a note
          to keep that context with your project.
        </dd>
      </dl>
    </Dialog>
  );
}
