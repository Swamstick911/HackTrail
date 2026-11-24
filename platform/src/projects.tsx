import { useEffect, useState } from 'react';
import type { Dashboard } from '../../src/platform/analytics.js';
import type { PlatformProject } from '../../src/platform/store.js';
import type { ProjectDetails } from '../../src/platform/contracts.js';
import type { TimelinePage } from '../../src/shared/events.js';
import { kindLabels } from '../../src/shared/events.js';
import type { TrackingReport } from '../../src/shared/tracking.js';
import type { ActivityReview } from '../../src/shared/review.js';
import { api, downloadJson, useAction, useResource } from './api.js';
import { Empty, Icon, Loading, Notice, PageHeader, ProjectRows, Stats } from './components.js';
import { ReportBuilder } from './reports.js';

function details(form: HTMLFormElement): ProjectDetails {
  const data = new FormData(form);
  return {
    name: String(data.get('name')).trim(),
    description: String(data.get('description') ?? '').trim(),
    repositoryUrl: String(data.get('repositoryUrl') ?? '').trim(),
    demoUrl: String(data.get('demoUrl') ?? '').trim(),
    visibility: data.get('visibility') === 'public' ? 'public' : 'private',
    archived: data.has('archived'),
  };
}
function ProjectFields({ project }: { project?: PlatformProject }) {
  return (
    <>
      <label>
        Project name
        <input name="name" maxLength={80} defaultValue={project?.name} required />
      </label>
      <label>
        What are you making?
        <textarea
          name="description"
          maxLength={500}
          defaultValue={project?.description}
          rows={3}
          placeholder="A few words about your project"
        />
      </label>
      <div className="two-columns">
        <label>
          Repository URL
          <input
            type="url"
            name="repositoryUrl"
            placeholder="https://github.com/you/project"
            defaultValue={project?.repositoryUrl}
          />
        </label>
        <label>
          Live project URL
          <input
            type="url"
            name="demoUrl"
            placeholder="https://your-project.example"
            defaultValue={project?.demoUrl}
          />
        </label>
      </div>
      <label>
        Project visibility
        <select name="visibility" defaultValue={project?.visibility ?? 'private'}>
          <option value="private">Private: only you and reports you share</option>
          <option value="public">
            Public: project details and activity totals on your profile
          </option>
        </select>
      </label>
      {project && (
        <label className="check-label">
          <input name="archived" type="checkbox" defaultChecked={project.archived} />
          Archive this project
          <span className="field-help">
            Keep its history and hide it from projects in progress.
          </span>
        </label>
      )}
    </>
  );
}
export function Projects({ navigate }: { navigate: (path: string) => void }) {
  const resource = useResource<Dashboard>('/dashboard?days=30', 30_000);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const projects =
    resource.data?.projects.filter(
      (project) =>
        (archived || !project.archived) &&
        project.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Things you are making"
        title="Your projects"
        action={
          <button className="primary" onClick={() => setCreating(!creating)}>
            <Icon name={creating ? 'close' : 'plus'} />
            {creating ? 'Cancel' : 'New project'}
          </button>
        }
      >
        Activity arrives from your editor. Give each project a little context.
      </PageHeader>
      {(resource.error || action.error) && (
        <Notice error>{resource.error?.message || action.error}</Notice>
      )}
      {creating && (
        <section className="panel">
          <h2>A new place to build</h2>
          <p className="muted small">Connected editors also create projects automatically.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = details(event.currentTarget);
              void action.run(async () => {
                const project = await api<PlatformProject>('/projects', input);
                navigate('/projects/' + project.id);
              });
            }}
          >
            <ProjectFields />
            <button className="primary" disabled={action.busy}>
              Create project
            </button>
          </form>
        </section>
      )}
      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a project"
          />
        </label>
        <label className="check-label inline">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Show archived
        </label>
        <span className="small muted">Last 30 days</span>
      </div>
      {resource.loading ? (
        <Loading />
      ) : (
        <section className="panel">
          {projects.length ? (
            <ProjectRows projects={projects} onOpen={(id) => navigate('/projects/' + id)} />
          ) : (
            <Empty title={search ? 'No matching projects' : 'Start with something you care about.'}>
              {search
                ? 'Try a different name or include archived projects.'
                : 'Connect your editor to bring your work into HackTrail.'}
              <br />
              {!search && (
                <button className="text-button" onClick={() => navigate('/connections')}>
                  Connect an editor
                </button>
              )}
            </Empty>
          )}
        </section>
      )}
    </>
  );
}
function Activity({ id }: { id: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useResource<TimelinePage>(
    '/projects/' +
      id +
      '/events?limit=30' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Project trail</h2>
        <span className="small muted">{resource.data?.total ?? 0} events</span>
      </div>
      {resource.error && <Notice error>{resource.error.message}</Notice>}
      {resource.loading && <Loading />}
      {resource.data &&
        (resource.data.events.length ? (
          <>
            <ol className="activity-list">
              {resource.data.events.map((event) => (
                <li key={event.id}>
                  <span className={'event-dot ' + (event.source === 'git' ? 'git' : '')} />
                  <div>
                    <div className="event-heading">
                      <strong>{kindLabels[event.kind]}</strong>
                      <span className="pill">{event.source}</span>
                    </div>
                    {event.metadata.excerpt && <p>{event.metadata.excerpt}</p>}
                    {event.metadata.toolName && (
                      <p className="muted small">
                        {event.metadata.toolName}
                        {event.metadata.success === false ? ' · Did not complete successfully' : ''}
                      </p>
                    )}
                    {event.metadata.git && (
                      <p className="muted small">
                        <code>{event.metadata.git.commit.slice(0, 8)}</code>
                        {event.metadata.git.branch ? ' · ' + event.metadata.git.branch : ''}
                      </p>
                    )}
                    <time className="small muted" dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
            <div className="actions">
              {cursor && <button onClick={() => setCursor(null)}>Newest activity</button>}
              {resource.data.nextCursor && (
                <button onClick={() => setCursor(resource.data!.nextCursor)}>Older activity</button>
              )}
            </div>
          </>
        ) : (
          <Empty title="The trail starts with your next session.">
            Editor time appears in the totals. Agent and Git events appear here when you choose to
            sync them.
          </Empty>
        ))}
    </section>
  );
}
export function ProjectPage({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const project = useResource<PlatformProject>('/projects/' + encodeURIComponent(id));
  const [tab, setTab] = useState<'activity' | 'report' | 'settings'>('activity');
  const [days, setDays] = useState(7);
  const [revision, setRevision] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setRangeEnd(new Date().toISOString()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const rangeStart = new Date(Date.parse(rangeEnd) - days * 86400_000).toISOString();
  const work = useResource<{ tracking: TrackingReport; review: ActivityReview }>(
    '/projects/' +
      encodeURIComponent(id) +
      '/work?' +
      new URLSearchParams({ from: rangeStart, to: rangeEnd }),
    15_000,
  );
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (project.loading) return <Loading />;
  if (!project.data) return <Notice error>{project.error?.message ?? 'Project not found.'}</Notice>;
  const data = project.data;
  return (
    <>
      <button className="text-button back-link" onClick={() => navigate('/projects')}>
        Back to projects
      </button>
      <PageHeader
        eyebrow={data.visibility + ' project'}
        title={data.name}
        action={
          <button
            onClick={() =>
              void action.run(async () =>
                downloadJson(await api('/projects/' + id + '/export'), 'hacktrail-project.json'),
              )
            }
          >
            <Icon name="download" />
            Export
          </button>
        }
      >
        {data.description || 'A record of the work behind your project.'}
      </PageHeader>
      {(action.error || work.error) && <Notice error>{action.error || work.error?.message}</Notice>}
      <div className="project-links">
        {data.repositoryUrl && (
          <a href={data.repositoryUrl} target="_blank" rel="noreferrer">
            <Icon name="code" />
            Repository
          </a>
        )}
        {data.demoUrl && (
          <a href={data.demoUrl} target="_blank" rel="noreferrer">
            Live project
          </a>
        )}
      </div>
      <div className="tabs" role="tablist" aria-label="Project views">
        {(['activity', 'report', 'settings'] as const).map((name) => (
          <button
            role="tab"
            aria-selected={tab === name}
            key={name}
            onClick={() => {
              setTab(name);
              setSaved(false);
            }}
          >
            {name === 'activity'
              ? 'Activity'
              : name === 'report'
                ? 'Share a report'
                : 'Project settings'}
          </button>
        ))}
      </div>
      {tab === 'activity' && (
        <>
          <div className="section-heading">
            <h2>Time at a glance</h2>
            <select
              aria-label="Project statistics period"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
          {work.data && (
            <>
              <Stats
                stats={{
                  totalMs: work.data.tracking.totalMs,
                  agentMs: work.data.review.agentMs,
                  overlapMs: work.data.review.overlapMs,
                }}
              />
              {work.data.review.incompleteRuns > 0 && (
                <Notice>
                  {work.data.review.incompleteRuns} agent run(s) have a missing boundary. Their
                  duration is not counted.
                </Notice>
              )}
            </>
          )}
          <section className="panel">
            <h2>Leave a note for future you</h2>
            <form
              className="note-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const text = String(new FormData(form).get('text'));
                void action.run(async () => {
                  await api('/projects/' + id + '/notes', { text });
                  form.reset();
                  setRevision((value) => value + 1);
                });
              }}
            >
              <textarea
                name="text"
                aria-label="Project note"
                maxLength={500}
                rows={2}
                required
                placeholder="What changed? What did you figure out?"
              />
              <div className="section-heading">
                <span className="small muted">
                  Private unless you include it in a shared report.
                </span>
                <button disabled={action.busy}>Save note</button>
              </div>
            </form>
          </section>
          <Activity key={revision} id={id} />
        </>
      )}
      {tab === 'report' && <ReportBuilder project={data} />}
      {tab === 'settings' && (
        <>
          <section className="panel">
            <h2>Project details</h2>
            {saved && <Notice>Project settings saved.</Notice>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const input = details(event.currentTarget);
                void action.run(async () => {
                  await api('/projects/' + id, input, 'PUT');
                  setSaved(true);
                  project.refresh();
                });
              }}
            >
              <ProjectFields project={data} />
              <button className="primary" disabled={action.busy}>
                Save project
              </button>
            </form>
          </section>
          <section className="panel danger-zone">
            <h2>Delete project</h2>
            <p className="muted">
              This removes its activity, notes, and shared reports from your account. A deleted
              synced project will not be recreated by background uploads.
            </p>
            {deleting ? (
              <div className="actions">
                <button
                  className="danger"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api('/projects/' + id, undefined, 'DELETE');
                      navigate('/projects');
                    })
                  }
                >
                  Permanently delete {data.name}
                </button>
                <button onClick={() => setDeleting(false)}>Keep project</button>
              </div>
            ) : (
              <button onClick={() => setDeleting(true)}>Delete this project</button>
            )}
          </section>
        </>
      )}
    </>
  );
}
