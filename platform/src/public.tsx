import type { Dashboard } from '../../src/platform/analytics.js';
import type { Profile } from '../../src/platform/contracts.js';
import { useResource } from './api.js';
import {
  Breakdown,
  Empty,
  Loading,
  Notice,
  PageHeader,
  ProjectRows,
  Stats,
  WeekChart,
  durationLabel,
} from './components.js';

export function PublicProfile({ handle }: { handle: string }) {
  const resource = useResource<{
    profile: Pick<Profile, 'handle' | 'name' | 'bio' | 'timezone'>;
    stats: Dashboard;
  }>('/public/profiles/' + encodeURIComponent(handle));
  return (
    <>
      {resource.loading && <Loading />}
      {resource.error && <Notice error>{resource.error.message}</Notice>}
      {resource.data && (
        <>
          <PageHeader
            eyebrow={'@' + resource.data.profile.handle}
            title={resource.data.profile.name}
          >
            {resource.data.profile.bio || 'Making things, one session at a time.'}
          </PageHeader>
          <p className="muted small">
            Published projects · Last 7 days · {resource.data.profile.timezone}
          </p>
          <Stats stats={resource.data.stats} />
          <section className="panel">
            <h2>This week</h2>
            <WeekChart daily={resource.data.stats.daily} />
          </section>
          <div className="two-columns">
            <Breakdown title="Languages" values={resource.data.stats.languages} />
            <Breakdown title="Editors" values={resource.data.stats.editors} />
          </div>
          <section className="panel">
            <h2>Published projects</h2>
            {resource.data.stats.projects.length ? (
              <>
                <ProjectRows projects={resource.data.stats.projects} />
                {resource.data.stats.projects.map((project) => (
                  <div className="public-project-links" key={project.id}>
                    <strong>{project.name}</strong>
                    {project.repositoryUrl && (
                      <a href={project.repositoryUrl} rel="noreferrer" target="_blank">
                        Repository
                      </a>
                    )}
                    {project.demoUrl && (
                      <a href={project.demoUrl} rel="noreferrer" target="_blank">
                        Live project
                      </a>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <Empty title="Still behind the scenes">
                This builder has not published a project yet.
              </Empty>
            )}
          </section>
          <p className="footnote">
            Only deliberately published projects appear here. Activity totals do not verify
            authorship or represent approved program hours.
          </p>
        </>
      )}
    </>
  );
}
export function Community() {
  const resource =
    useResource<{ handle: string; name: string; bio: string; totalMs: number; projects: number }[]>(
      '/public/community',
    );
  return (
    <>
      <PageHeader eyebrow="A little shared momentum" title="Builders this week">
        An opt-in board of public project activity. Everyone’s pace is different.
      </PageHeader>
      <p className="small muted">
        Last 7 days in UTC · Up to 100 builders · Recorded editor activity
      </p>
      {resource.loading && <Loading />}
      {resource.error && <Notice error>{resource.error.message}</Notice>}
      <section className="panel">
        {resource.data?.length ? (
          <ol className="community-list">
            {resource.data.map((person, index) => (
              <li key={person.handle}>
                <span className="muted rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <a href={'/u/' + person.handle}>{person.name}</a>
                  <span className="muted small block">
                    @{person.handle} · {person.projects} published project(s)
                  </span>
                </div>
                <strong>{durationLabel(person.totalMs)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="A community starts with a few builders.">
            Publish a project and enable the community board in Settings to take part.
          </Empty>
        )}
      </section>
      <p className="footnote">
        This board is for encouragement. More recorded time does not mean better work, greater
        effort, or more approved hours.
      </p>
    </>
  );
}
