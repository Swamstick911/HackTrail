import { useEffect, useState } from 'react';
import type { Project } from '../../src/shared/events.js';
import { api, downloadExtension, errorMessage } from './api.js';
import { Dialog } from './dialogs.js';
import { Icon } from './icons.js';

export function ConnectionsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editorLink =
    'vscode://swamstick911.hacktrail/enable?' +
    new URLSearchParams({
      projectId: project.id,
      collector: import.meta.env.DEV ? 'http://127.0.0.1:47654' : window.location.origin,
    }).toString();
  useEffect(() => {
    let active = true;
    void api<{ editorDownloadAvailable: boolean }>('/integrations')
      .then((result) => {
        if (active) setAvailable(result.editorDownloadAvailable);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
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
      {project.isExample ? (
        <p className="callout">
          This is an example. Create your own project before enabling tracking.
        </p>
      ) : (
        <>
          <div className="connection-intro">
            <span className="tool-symbol editor">
              <Icon name="code" />
            </span>
            <div>
              <h3>Set it up once. Then just work.</h3>
              <p>VS Code manages the collector, Git context, and agent hooks.</p>
            </div>
          </div>
          <ol className="setup-steps">
            <li>Download the extension below.</li>
            <li>
              In VS Code, run <strong>Extensions: Install from VSIX</strong> and select the file.
            </li>
            <li>
              Open your project folder, then use <strong>Enable in VS Code</strong> below to link it
              to <strong>{project.name}</strong>. Accept the tracking prompt.
            </li>
          </ol>
          <button
            className="primary full-width"
            disabled={busy || !available}
            onClick={() => void download()}
          >
            <Icon name="download" />
            {busy ? 'Preparing download...' : 'Download VS Code extension'}
          </button>
          <p>
            <a className="text-button" href={editorLink}>
              Enable in VS Code
            </a>
          </p>
          <p className="small muted">
            Already installed? Use the link above. Starting from VS Code also works:{' '}
            <strong>HackTrail: Enable Tracking</strong> creates a project from your folder
            automatically.
          </p>
          <p className="callout">
            Claude, Codex, and Git collection are included when you choose{' '}
            <strong>Enable tracking</strong>. No Claude account connection or terminal command is
            needed. Choose <strong>Editor only</strong> to skip all three.
          </p>
          <p className="small muted">
            Everything stays on this computer. We collect activity timestamps, tool names, outcomes,
            agent runtime, and Git commit IDs, branch names, and change counts. Code, prompt text,
            tool arguments, and output are excluded. Restart an existing Claude session once to load
            the hooks. In Codex, open /hooks to review and trust the new hooks. Until then, no Codex
            activity is recorded.
          </p>
          {available === false && (
            <p className="small muted">
              The extension download is unavailable from this collector. Use the extension package
              supplied with your HackTrail build.
            </p>
          )}
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
          Claude and Codex runtime comes from paired live start and stop hooks. Overlapping runs
          count once. It is never added to editor time. Interrupted runs count up to their interrupt
          event. Unmatched boundaries and runs longer than 12 hours are excluded.
        </dd>
        <dt>Git adds context</dt>
        <dd>
          Commit IDs and branches link samples to the last observed repository state. Checkpoints
          and change counts do not add time or prove authorship. Git collection requires opening the
          repository root.
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
