import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import type { ActivityEvent, Project } from '../../src/shared/events.js';
import { api, errorMessage } from './api.js';
import { Icon } from './icons.js';

function Dialog({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(
        await api<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Start a project trail" onClose={onClose} busy={busy}>
      <p className="muted">
        Give your work a home. You can import activity after creating the project.
      </p>
      <form onSubmit={submit}>
        <label className="field">
          Project name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What are you building?"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating...' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ImportPreview {
  events: ActivityEvent[];
  eventCount: number;
  ignoredRecords: number;
}

export function ImportDialog({
  project,
  onClose,
  onImported,
}: {
  project: Project;
  onClose: () => void;
  onImported: (result: { inserted: number; duplicates: number }) => void;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [excerpts, setExcerpts] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function chooseFile(selected?: File) {
    setFile(null);
    setPreview(null);
    setError('');
    if (!selected) return;
    if (selected.size > 10 * 1024 * 1024) {
      setError('Choose a transcript smaller than 10 MB.');
      return;
    }
    setBusy(true);
    try {
      setFile({ name: selected.name, text: await selected.text() });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function runImport(commit: boolean) {
    if (!file) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      projectId: project.id,
      fileName: file.name,
      text: file.text,
      includeExcerpts: excerpts,
    });
    try {
      if (commit) onImported(await api('/imports/claude', { method: 'POST', body }));
      else setPreview(await api<ImportPreview>('/imports/preview', { method: 'POST', body }));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Import Claude activity" onClose={onClose} busy={busy}>
      <p className="muted">
        Add a selected Claude Code JSONL transcript to <strong>{project.name}</strong>. Nothing is
        stored until you confirm.
      </p>
      <label className="file-picker">
        <Icon name="upload" width="28" height="28" />
        <strong>{file?.name ?? 'Choose a transcript file'}</strong>
        <span>Claude Code JSONL, up to 10 MB</span>
        <input
          type="file"
          aria-label="Transcript file"
          accept=".jsonl,.json"
          disabled={busy}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
          }}
        />
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={excerpts}
          disabled={busy}
          onChange={(event) => {
            setExcerpts(event.target.checked);
            setPreview(null);
          }}
        />
        <span>
          <strong>Include message excerpts</strong>
          <small>
            Optional. Stores up to 500 characters per message locally. Excerpts may contain private
            information.
          </small>
        </span>
      </label>
      {preview && (
        <div className="import-preview" role="status">
          <strong>{preview.eventCount} events ready to import</strong>
          <p>
            {preview.ignoredRecords} unrelated records skipped. Existing identical events will be
            skipped too.
          </p>
          <div className="preview-kinds">
            {[...new Set(preview.events.map((event) => event.actor))].map((actor) => (
              <span className={'actor-pill ' + actor} key={actor}>
                {actor}
              </span>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!file || busy}
          onClick={() => {
            void runImport(Boolean(preview));
          }}
        >
          {busy
            ? 'Reading...'
            : preview
              ? 'Import ' + preview.eventCount + ' events'
              : 'Preview import'}
        </button>
      </div>
    </Dialog>
  );
}

export function DeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    try {
      await api('/projects/' + project.id, { method: 'DELETE' });
      onDeleted();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Delete this project?" onClose={onClose} busy={busy}>
      <p>
        This removes <strong>{project.name}</strong> and its recorded events from HackTrail. Your
        original transcript files are unchanged.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            void remove();
          }}
        >
          {busy ? 'Deleting...' : 'Delete project'}
        </button>
      </div>
    </Dialog>
  );
}
