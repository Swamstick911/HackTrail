import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityEvent, Actor, Project, TimelinePage } from '../../src/shared/events.js';
import { api, errorMessage, saveDownload } from './api.js';
import { Icon } from './icons.js';
import { DeleteDialog, ImportDialog, NewProjectDialog } from './dialogs.js';
import { ConnectionsDialog, TimePolicyDialog } from './connections.js';
import { EvidencePanel, Timeline } from './timeline.js';
import { ReviewView, TodayView, weekDays, type WorkData } from './work.js';

const emptyPage: TimelinePage = { events: [], total: 0, nextCursor: null };
type View = 'today' | 'activity' | 'review';
const views = [
  { id: 'today', label: 'Today', icon: 'clock' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'review', label: 'Review', icon: 'review' },
] as const;

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [view, setView] = useState<View>('today');
  const [page, setPage] = useState<TimelinePage>(emptyPage);
  const [work, setWork] = useState<WorkData | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [actor, setActor] = useState<Actor | ''>('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<
    'create' | 'import' | 'delete' | 'connect' | 'policy' | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(false);
  const historyRef = useRef(false);
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
    const current = ++requestNumber.current;
    setSelectedEvent(null);
    historyRef.current = false;
    setHistory(false);
    if (!projectId) {
      setPage(emptyPage);
      setWork(null);
      return () => controller.abort();
    }
    setLoading(true);
    let pending = false;
    async function update() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      const days = weekDays();
      const range = new URLSearchParams({
        from: new Date(days[0]!.start).toISOString(),
        to: new Date(days[6]!.end).toISOString(),
      });
      const query = new URLSearchParams({ limit: '60' });
      if (actor) query.set('actor', actor);
      if (search) query.set('search', search);
      try {
        const [nextWork, nextPage] = await Promise.all([
          api<WorkData>('/projects/' + projectId + '/work?' + range, { signal: controller.signal }),
          historyRef.current
            ? Promise.resolve(null)
            : api<TimelinePage>('/projects/' + projectId + '/events?' + query, {
                signal: controller.signal,
              }),
        ]);
        if (requestNumber.current !== current) return;
        setWork(nextWork);
        if (nextPage && !historyRef.current) setPage(nextPage);
        setConnected(true);
        setError('');
      } catch (error) {
        if (!controller.signal.aborted) {
          setConnected(false);
          setError(errorMessage(error));
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const initial = setTimeout(() => void update(), search ? 200 : 0);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void update();
    }, 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
      controller.abort();
    };
  }, [projectId, actor, search, refresh]);

  function selectProject(id: string) {
    setProjectId(id);
    setActor('');
    setSearch('');
    setNotice('');
    setPage(emptyPage);
    setWork(null);
    setSelectedEvent(null);
  }

  async function showExample() {
    setBusy(true);
    try {
      const result = await api<{ project: Project }>('/example', { method: 'POST', body: '{}' });
      await loadProjects(result.project.id);
      setView('activity');
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!page.nextCursor || busy) return;
    const current = requestNumber.current;
    const query = new URLSearchParams({ limit: '60', cursor: page.nextCursor });
    if (actor) query.set('actor', actor);
    if (search) query.set('search', search);
    setBusy(true);
    historyRef.current = true;
    setHistory(true);
    try {
      const next = await api<TimelinePage>('/projects/' + projectId + '/events?' + query);
      if (requestNumber.current === current)
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
      saveDownload(
        new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }),
        'hacktrail-' + projectId + '.json',
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function pauseTracking() {
    setBusy(true);
    try {
      await api('/tracking/pause', {
        method: 'POST',
        body: JSON.stringify({ paused: !work?.tracking.paused }),
      });
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="HackTrail home">
          <span className="brand-symbol">
            h<span>.</span>
          </span>
          <span>hacktrail</span>
        </a>
        <div className="workspace-name">
          <span className="workspace-avatar">W</span>
          <div>
            Your workspace<small>Local to this device</small>
          </div>
        </div>
        <nav className="view-nav" aria-label="Workspace views">
          {views.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'selected' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => {
                setView(item.id);
                setSelectedEvent(null);
              }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <h2>Projects</h2>
          <button
            className="icon-button"
            aria-label="New project"
            onClick={() => setDialog('create')}
          >
            <Icon name="plus" width="18" height="18" />
          </button>
        </div>
        <nav className="project-list" aria-label="Projects">
          {projects.map((item) => (
            <button
              key={item.id}
              className={'project-link ' + (item.id === projectId ? 'selected' : '')}
              aria-current={item.id === projectId ? 'true' : undefined}
              onClick={() => selectProject(item.id)}
            >
              <span className="project-avatar">{item.name.charAt(0).toUpperCase()}</span>
              <span>
                {item.name}
                {item.isExample && <small>Example</small>}
              </span>
            </button>
          ))}
          {!projects.length && <p className="sidebar-empty">No projects yet.</p>}
        </nav>
        <label className="mobile-project">
          <span className="sr-only">Current project</span>
          <select value={projectId} onChange={(event) => selectProject(event.target.value)}>
            {!projects.length && <option value="">Choose a project</option>}
            {projects.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sidebar-bottom">
          <button
            className="sidebar-connection"
            disabled={!project}
            onClick={() => setDialog('connect')}
          >
            <Icon name="connect" />
            Connections
          </button>
          <div className="collector-status">
            <span className={'status-dot ' + (connected ? 'online' : '')} />
            {connected ? 'Collector online' : 'Collector offline'}
            <span>v0.2</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span> <strong>{project?.name ?? 'Getting started'}</strong>
          </span>
          <span className="topbar-date">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <p className="page-context">
                {view === 'today'
                  ? 'Make something worth your time.'
                  : view === 'activity'
                    ? 'The details behind the work.'
                    : 'Put your work in perspective.'}
              </p>
              <h1>{project?.name ?? 'What are you working on?'}</h1>
            </div>
            {project && (
              <div className="header-actions">
                {view === 'activity' ? (
                  <>
                    <button onClick={() => void exportProject()} disabled={busy}>
                      <Icon name="download" />
                      Export JSON
                    </button>
                    <button onClick={() => setDialog('import')}>
                      <Icon name="upload" />
                      Import activity
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setDialog('import')}>
                      <Icon name="upload" />
                      Import activity
                    </button>
                    {work?.tracking.clients.some((client) => client.state !== 'disconnected') ||
                    work?.tracking.paused ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void pauseTracking()}
                      >
                        <Icon name={work?.tracking.paused ? 'play' : 'pause'} />
                        {work?.tracking.paused ? 'Resume tracking' : 'Pause tracking'}
                      </button>
                    ) : (
                      <button className="primary" onClick={() => setDialog('connect')}>
                        <Icon name="connect" />
                        Connect VS Code
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button
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
            <div className="banner success" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice('')}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {project?.isExample && (
            <div className="example-banner">
              <strong>Example project</strong>
              <span>
                This is synthetic activity, so you can explore without connecting your tools.
              </span>
            </div>
          )}
          {!project && !loading && (
            <section className="onboarding">
              <div className="onboarding-symbol">
                <Icon name="folder" width="36" height="36" />
              </div>
              <h2>Start with one project.</h2>
              <p>
                Connect your editor, see where your time goes, and keep the story of what you made.
              </p>
              <button className="primary" onClick={() => setDialog('create')}>
                <Icon name="plus" />
                Create your first project
              </button>
              <button
                className="text-button"
                disabled={busy || !connected}
                onClick={() => void showExample()}
              >
                Explore an example
              </button>
              <div className="onboarding-details">
                <div>
                  <Icon name="clock" />
                  <strong>Time, without the timer</strong>
                  <p>Your editor records activity and stops counting when you leave.</p>
                </div>
                <div>
                  <Icon name="review" />
                  <strong>Keep the context</strong>
                  <p>Agent activity and your notes help explain what happened.</p>
                </div>
                <div>
                  <Icon name="shield" />
                  <strong>A local workspace</strong>
                  <p>Your records stay here until you choose to export them.</p>
                </div>
              </div>
            </section>
          )}
          {project && (
            <>
              <div className="view-heading">
                <h2>{views.find((item) => item.id === view)?.label}</h2>
                <span>
                  {view === 'today'
                    ? 'Updates automatically'
                    : view === 'activity'
                      ? 'All recorded activity'
                      : 'Last 7 days'}
                </span>
              </div>
              {view === 'today' && work && (
                <TodayView
                  key={project.id}
                  data={work}
                  projectId={project.id}
                  onConnect={() => setDialog('connect')}
                  onPolicy={() => setDialog('policy')}
                  onUpdated={() => setRefresh((value) => value + 1)}
                />
              )}
              {view === 'review' && work && (
                <ReviewView
                  data={work}
                  busy={busy}
                  onExport={() => void exportProject()}
                  onPolicy={() => setDialog('policy')}
                />
              )}
              {view !== 'activity' && !work && (
                <div className="loading-state" role="status">
                  Loading your workspace...
                </div>
              )}
              {view === 'activity' && (
                <div className={'timeline-layout ' + (selectedEvent ? 'with-evidence' : '')}>
                  <section className="panel timeline-card" aria-label="Project timeline">
                    <div className="panel-heading">
                      <h2>Project timeline</h2>
                      <span className="pill">{page.total} events</span>
                    </div>
                    <div className="timeline-filters">
                      <label className="search-field">
                        <Icon name="search" />
                        <input
                          aria-label="Search activity"
                          maxLength={100}
                          placeholder="Search activity"
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
                        <option value="user">User activity</option>
                        <option value="agent">Agent activity</option>
                        <option value="tool">Tool results</option>
                        <option value="unknown">Unknown actor</option>
                      </select>
                    </div>
                    {history && (
                      <div className="history-notice">
                        Browsing earlier activity.
                        <button
                          className="text-button"
                          onClick={() => setRefresh((value) => value + 1)}
                        >
                          Back to latest
                        </button>
                      </div>
                    )}
                    {loading ? (
                      <div className="loading-state" role="status">
                        Loading activity...
                      </div>
                    ) : page.events.length ? (
                      <Timeline
                        events={page.events}
                        selectedId={selectedEvent?.id}
                        onSelect={setSelectedEvent}
                      />
                    ) : (
                      <div className="empty-work">
                        <span className="empty-icon">
                          <Icon name="activity" width="28" height="28" />
                        </span>
                        <h3>
                          {actor || search ? 'No matching activity.' : 'The story starts here.'}
                        </h3>
                        <p>
                          {actor || search
                            ? 'Try another search or filter.'
                            : 'Connect Claude Code for live events, or import an existing session.'}
                        </p>
                        {!actor && !search && (
                          <button onClick={() => setDialog('connect')}>Connect your tools</button>
                        )}
                      </div>
                    )}
                    {page.nextCursor && !loading && (
                      <div className="load-more">
                        <button disabled={busy} onClick={() => void loadMore()}>
                          {busy ? 'Loading...' : 'Load earlier events'}
                        </button>
                      </div>
                    )}
                    <div className="timeline-footer">
                      <span>Newest first</span>
                      <span>Select an event for its details</span>
                    </div>
                  </section>
                  {selectedEvent && (
                    <EvidencePanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
                  )}
                </div>
              )}
              <footer className="project-footer">
                <button className="text-button" onClick={() => setDialog('policy')}>
                  How HackTrail counts time
                </button>
                <button className="text-button quiet" onClick={() => setDialog('delete')}>
                  Delete project
                </button>
              </footer>
            </>
          )}
          {!project && loading && <p role="status">Connecting to your workspace...</p>}
        </main>
      </div>
      {dialog === 'create' && (
        <NewProjectDialog
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            setDialog('connect');
            selectProject(created.id);
            setView('today');
            void loadProjects(created.id).catch((error) => setError(errorMessage(error)));
          }}
        />
      )}
      {dialog === 'import' && project && (
        <ImportDialog
          project={project}
          onClose={() => setDialog(null)}
          onImported={(result) => {
            setDialog(null);
            setView('activity');
            setNotice(
              result.inserted + ' events imported. ' + result.duplicates + ' duplicates skipped.',
            );
            setRefresh((value) => value + 1);
            void loadProjects(projectId).catch((error) => setError(errorMessage(error)));
          }}
        />
      )}
      {dialog === 'connect' && project && (
        <ConnectionsDialog project={project} onClose={() => setDialog(null)} />
      )}
      {dialog === 'policy' && <TimePolicyDialog onClose={() => setDialog(null)} />}
      {dialog === 'delete' && project && (
        <DeleteDialog
          project={project}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setNotice('Project deleted.');
            selectProject('');
            void loadProjects().catch((error) => setError(errorMessage(error)));
          }}
        />
      )}
    </div>
  );
}
