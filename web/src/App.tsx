import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityEvent,
  Actor,
  Project,
  ProjectSummary,
  TimelinePage,
} from '../../src/shared/events.js';
import { api, errorMessage } from './api.js';
import { Icon } from './icons.js';
import { DeleteDialog, ImportDialog, NewProjectDialog } from './dialogs.js';
import { EvidencePanel, Timeline } from './timeline.js';

const emptyPage: TimelinePage = { events: [], total: 0, nextCursor: null };

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [page, setPage] = useState<TimelinePage>(emptyPage);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [actor, setActor] = useState<Actor | ''>('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'create' | 'import' | 'delete' | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestNumber = useRef(0);
  const project = projects.find((item) => item.id === projectId);

  const loadProjects = useCallback(async (preferred?: string) => {
    const next = await api<Project[]>('/projects');
    setProjects(next);
    setProjectId((previous) => {
      const desired = preferred ?? previous;
      return next.some((item) => item.id === desired) ? desired : (next[0]?.id ?? '');
    });
    setConnected(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadProjects().catch((error) => {
      setError(errorMessage(error));
      setLoading(false);
    });
  }, [loadProjects]);

  useEffect(() => {
    const controller = new AbortController();
    const currentRequest = ++requestNumber.current;
    setSelectedEvent(null);
    if (!projectId) {
      setPage(emptyPage);
      setSummary(null);
      return () => controller.abort();
    }
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ limit: '60' });
    if (actor) query.set('actor', actor);
    if (search) query.set('search', search);
    const timer = setTimeout(
      () => {
        void Promise.all([
          api<TimelinePage>('/projects/' + projectId + '/events?' + query, {
            signal: controller.signal,
          }),
          api<ProjectSummary>('/projects/' + projectId + '/summary', { signal: controller.signal }),
        ])
          .then(([nextPage, nextSummary]) => {
            if (requestNumber.current !== currentRequest) return;
            setPage(nextPage);
            setSummary(nextSummary);
          })
          .catch((error) => {
            if (!controller.signal.aborted) setError(errorMessage(error));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      search ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, actor, search, refresh]);

  function selectProject(id: string) {
    setProjectId(id);
    setActor('');
    setSearch('');
    setNotice('');
    setPage(emptyPage);
    setSummary(null);
  }

  async function showExample() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ project: Project }>('/example', { method: 'POST', body: '{}' });
      await loadProjects(result.project.id);
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!page.nextCursor || busy) return;
    const currentRequest = requestNumber.current;
    const query = new URLSearchParams({ limit: '60', cursor: page.nextCursor });
    if (actor) query.set('actor', actor);
    if (search) query.set('search', search);
    setBusy(true);
    try {
      const next = await api<TimelinePage>('/projects/' + projectId + '/events?' + query);
      if (requestNumber.current === currentRequest)
        setPage((previous) => ({ ...next, events: [...previous.events, ...next.events] }));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportProject() {
    setBusy(true);
    try {
      const exported = await api<unknown>('/projects/' + projectId + '/export');
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hacktrail-' + projectId + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCreated(created: Project) {
    setDialog(null);
    selectProject(created.id);
    try {
      await loadProjects(created.id);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function onImported(result: { inserted: number; duplicates: number }) {
    setDialog(null);
    setNotice(result.inserted + ' events imported. ' + result.duplicates + ' duplicates skipped.');
    setRefresh((value) => value + 1);
    try {
      await loadProjects(projectId);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="HackTrail home">
          <span className="brand-symbol">
            <Icon name="trail" width="24" height="24" />
          </span>
          HackTrail<span className="version">0.1</span>
        </a>
        <button
          className="icon-button mobile-add"
          aria-label="New project"
          onClick={() => setDialog('create')}
        >
          <Icon name="plus" />
        </button>
        <div className="workspace-label">
          <span className="status-dot" /> YOUR LOCAL WORKSPACE
        </div>
        <div className="sidebar-section">
          <span className="eyebrow">PROJECTS</span>
          <button
            className="icon-button"
            aria-label="New project"
            onClick={() => setDialog('create')}
          >
            <Icon name="plus" width="17" height="17" />
          </button>
        </div>
        <nav className="project-list" aria-label="Projects">
          {projects.map((item) => (
            <button
              className={'project-link ' + (item.id === projectId ? 'active' : '')}
              key={item.id}
              onClick={() => selectProject(item.id)}
            >
              <span className="project-avatar">{item.name.charAt(0).toUpperCase()}</span>
              <span className="project-name">
                {item.name}
                <small>{item.isExample ? 'Example project' : item.eventCount + ' events'}</small>
              </span>
              <span className="project-arrow">
                <Icon name="arrow" width="14" height="14" />
              </span>
            </button>
          ))}
          {!projects.length && (
            <p className="sidebar-empty">Your first trail starts with a project.</p>
          )}
        </nav>
        <button className="sidebar-add" onClick={() => setDialog('create')}>
          <Icon name="plus" width="16" height="16" /> New project
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Icon name="shield" />
            <div>
              <strong>Stays on this device</strong>
              <p>
                Your records are local.
                <br />
                Sharing is always your choice.
              </p>
            </div>
          </div>
          <button
            className="text-button example-link"
            onClick={() => {
              void showExample();
            }}
            disabled={busy || !connected}
          >
            Explore example project <Icon name="arrow" width="15" height="15" />
          </button>
          <span className="sidebar-caption">Built for the work behind the work.</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Icon name="folder" width="17" height="17" />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{project?.name ?? 'Getting started'}</strong>
          </div>
          <span className="connection">
            <span className={'status-dot ' + (!connected ? 'offline' : '')} />
            {connected ? 'Local collector connected' : 'Connecting to collector'}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR WORK, WITH CONTEXT</p>
              <h1>{project?.name ?? 'Make room for your next idea.'}</h1>
              <p className="subtitle">
                {project
                  ? 'Follow the decisions, attempts, and activity behind your project.'
                  : 'A clear record of how your projects take shape, kept on your device.'}
              </p>
            </div>
            {project && (
              <div className="header-actions">
                <button
                  onClick={() => {
                    void exportProject();
                  }}
                  disabled={busy || !summary?.total}
                >
                  <Icon name="download" width="17" height="17" /> Export JSON
                </button>
                <button className="primary" onClick={() => setDialog('import')}>
                  <Icon name="upload" width="17" height="17" /> Import activity
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => {
                  setRefresh((value) => value + 1);
                  void loadProjects().catch((error) => setError(errorMessage(error)));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="success banner" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice('')}
              >
                <Icon name="close" width="16" height="16" />
              </button>
            </div>
          )}
          {project?.isExample && (
            <div className="example-banner">
              <span className="eyebrow">EXAMPLE PROJECT</span> This is synthetic activity. It is
              here to help you explore HackTrail.
            </div>
          )}
          {!project && !loading && (
            <div className="welcome-card">
              <div className="welcome-art" aria-hidden="true">
                <span className="art-line" />
                <span className="art-node one">
                  <Icon name="arrow" />
                </span>
                <span className="art-node two">
                  <Icon name="code" />
                </span>
                <span className="art-node three">
                  <Icon name="trail" />
                </span>
                <span className="art-card">
                  An idea.
                  <br />
                  <strong>A first attempt.</strong>
                  <br />A new direction.
                </span>
              </div>
              <p className="eyebrow">EVERY PROJECT STARTS SOMEWHERE</p>
              <h2>Your first trail is waiting.</h2>
              <p>
                Create a project and import a Claude Code session.
                <br />
                See the moments that moved your work forward.
              </p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => setDialog('create')}>
                  <Icon name="plus" width="17" height="17" /> Create your first project
                </button>
                <button
                  onClick={() => {
                    void showExample();
                  }}
                  disabled={busy || !connected}
                >
                  Explore an example <Icon name="arrow" width="17" height="17" />
                </button>
              </div>
              <p className="small muted">No account. No automatic upload. No timer to start.</p>
            </div>
          )}
          {project && (
            <>
              <section className="stats-grid" aria-label="Activity summary">
                <Stat
                  label="Recorded events"
                  value={summary?.total}
                  caption="The complete project trail"
                />
                <Stat
                  label="User messages"
                  value={summary?.userMessages}
                  caption="Messages in the source record"
                />
                <Stat
                  label="Agent activity"
                  value={summary?.agentEvents}
                  caption="Responses and tool calls"
                />
                <Stat
                  label="Tool results"
                  value={summary?.toolEvents}
                  caption="Outcomes worth looking into"
                />
              </section>
              <div className="activity-note">
                <span className="note-marker">i</span>
                <span>
                  Activity is context, not a stopwatch. This version records events without awarding
                  working hours.
                </span>
                <span className="phase-label">PHASE 1</span>
              </div>
              <div className={'timeline-layout ' + (selectedEvent ? 'with-evidence' : '')}>
                <section className="timeline-card" aria-label="Project timeline">
                  <div className="timeline-heading">
                    <div>
                      <h2>Project timeline</h2>
                      <p>The details behind your progress.</p>
                    </div>
                    <span className="count-label">{page.total} events</span>
                  </div>
                  <div className="timeline-filters">
                    <label className="search-field">
                      <Icon name="search" width="17" height="17" />
                      <input
                        aria-label="Search activity"
                        maxLength={100}
                        placeholder="Search activity..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter by actor"
                      value={actor}
                      onChange={(event) => setActor(event.target.value as Actor | '')}
                    >
                      <option value="">All activity</option>
                      <option value="user">User messages</option>
                      <option value="agent">Agent activity</option>
                      <option value="tool">Tool results</option>
                      <option value="unknown">Unknown actor</option>
                    </select>
                  </div>
                  {loading ? (
                    <div className="timeline-empty" role="status">
                      Loading your trail...
                    </div>
                  ) : page.events.length ? (
                    <Timeline
                      events={page.events}
                      selectedId={selectedEvent?.id}
                      onSelect={setSelectedEvent}
                    />
                  ) : (
                    <div className="timeline-empty">
                      <Icon name="trail" width="32" height="32" />
                      <h3>
                        {search || actor
                          ? 'No matching activity'
                          : 'This trail is just getting started.'}
                      </h3>
                      <p>
                        {search || actor
                          ? 'Try another search or filter.'
                          : 'Import a session to see the first events here.'}
                      </p>
                      {!search && !actor && (
                        <button onClick={() => setDialog('import')}>
                          Import a Claude session <Icon name="arrow" width="15" height="15" />
                        </button>
                      )}
                    </div>
                  )}
                  {page.nextCursor && !loading && (
                    <div className="load-more">
                      <button
                        disabled={busy}
                        onClick={() => {
                          void loadMore();
                        }}
                      >
                        {busy ? 'Loading...' : 'Load earlier events'}
                      </button>
                    </div>
                  )}
                  <div className="timeline-footer">
                    <span>Newest first</span>
                    <span>Click an event to inspect its evidence</span>
                  </div>
                </section>
                {selectedEvent && (
                  <EvidencePanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
                )}
              </div>
              <footer className="project-footer">
                <span>Only the activity you choose to import appears here.</span>
                <button className="text-button" onClick={() => setDialog('delete')}>
                  Delete project
                </button>
              </footer>
            </>
          )}
          {!project && loading && <p role="status">Connecting to your local workspace...</p>}
        </main>
      </div>
      {dialog === 'create' && (
        <NewProjectDialog
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            void onCreated(created);
          }}
        />
      )}
      {dialog === 'import' && project && (
        <ImportDialog
          project={project}
          onClose={() => setDialog(null)}
          onImported={(result) => {
            void onImported(result);
          }}
        />
      )}
      {dialog === 'delete' && project && (
        <DeleteDialog
          project={project}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setNotice('Project deleted.');
            setProjectId('');
            void loadProjects().catch((error) => setError(errorMessage(error)));
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, caption }: { label: string; value?: number; caption: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value === undefined ? '...' : value.toLocaleString()}</strong>
      <small>{caption}</small>
    </div>
  );
}
