import { useState } from 'react';
import type { Profile } from '../../src/platform/contracts.js';
import type { Dashboard } from '../../src/platform/analytics.js';
import { api, useAction, useResource } from './api.js';
import {
  Breakdown,
  Empty,
  Icon,
  Loading,
  Notice,
  PageHeader,
  ProjectRows,
  Stats,
  WeekChart,
  durationLabel,
} from './components.js';

export function Overview({
  profile,
  navigate,
}: {
  profile: Profile;
  navigate: (path: string) => void;
}) {
  const [days, setDays] = useState(7);
  const resource = useResource<Dashboard>('/dashboard?days=' + days, 15_000);
  const action = useAction();
  const stats = resource.data;
  return (
    <>
      <PageHeader
        eyebrow="Your workspace"
        title={'Keep going, ' + profile.name.split(' ')[0] + '.'}
        action={
          <select
            aria-label="Statistics period"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        }
      >
        A little perspective on what you have been building.
      </PageHeader>
      {(resource.error || action.error) && (
        <Notice error>{resource.error?.message || action.error}</Notice>
      )}
      {resource.loading && <Loading />}
      {stats && (
        <>
          <div className="status-line">
            <span className={'status-dot' + (stats.paused ? ' paused' : '')} />
            <span>
              {stats.paused
                ? 'Account time is paused'
                : stats.projects.some((project) => project.active)
                  ? 'Activity is arriving from your editor'
                  : 'Ready for your next session'}
            </span>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api('/tracking/pause', { paused: !stats.paused });
                  resource.refresh();
                })
              }
            >
              {stats.paused ? 'Resume account time' : 'Pause account time'}
            </button>
          </div>
          <Stats stats={stats} />
          {!stats.projects.length ? (
            <section className="welcome-panel">
              <div>
                <p className="eyebrow">A good place to start</p>
                <h2>Your next project belongs here.</h2>
                <p>
                  Connect VS Code, keep working as usual, and watch your project take shape. The
                  tracker works offline and syncs when you are back.
                </p>
                <button className="primary" onClick={() => navigate('/connections')}>
                  Connect your editor
                  <Icon name="arrow" />
                </button>
              </div>
              <div className="setup-steps">
                <div>
                  <span>1</span>Install the HackTrail extension
                </div>
                <div>
                  <span>2</span>Choose what to collect
                </div>
                <div>
                  <span>3</span>Approve your account connection
                </div>
              </div>
            </section>
          ) : null}
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Your rhythm</h2>
                <p className="small muted">
                  Editor activity · {profile.timezone.replaceAll('_', ' ')}
                </p>
              </div>
              <span className="small muted">{durationLabel(stats.totalMs)} this period</span>
            </div>
            <WeekChart daily={stats.daily} />
            {profile.dailyGoalMinutes > 0 && (
              <div className="goal-row">
                <span>Today’s goal</span>
                <progress
                  max={profile.dailyGoalMinutes * 60_000}
                  value={stats.daily.at(-1)?.totalMs ?? 0}
                  aria-label="Today's goal progress"
                />
                <span className="small muted">
                  {durationLabel(stats.daily.at(-1)?.totalMs ?? 0)} /{' '}
                  {durationLabel(profile.dailyGoalMinutes * 60_000)}
                </span>
              </div>
            )}
          </section>
          <div className="two-columns">
            <Breakdown title="Languages" values={stats.languages} />
            <Breakdown title="Editors" values={stats.editors} />
          </div>
          <section className="panel">
            <div className="section-heading">
              <h2>Projects in progress</h2>
              <button className="text-button" onClick={() => navigate('/projects')}>
                All projects
                <Icon name="arrow" />
              </button>
            </div>
            {stats.projects.length ? (
              <ProjectRows
                projects={stats.projects.filter((project) => !project.archived).slice(0, 6)}
                onOpen={(id) => navigate('/projects/' + id)}
              />
            ) : (
              <Empty title="Nothing recorded yet">
                Your projects will appear automatically when activity syncs.
              </Empty>
            )}
          </section>
          <p className="footnote">
            Editor activity and agent runtime describe different things. Overlap is included in
            both, so the clocks should not be added together. These totals are not program-approved
            hours.
          </p>
        </>
      )}
    </>
  );
}
