import { useState } from 'react';
import type { Profile } from '../../src/platform/contracts.js';
import type { Dashboard } from '../../src/platform/analytics.js';
import { api, useAction, useResource } from './api.js';
import {
  Breakdown,
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
        eyebrow="The work adds up"
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
        Here’s what you’ve been making time for.
      </PageHeader>
      {(resource.error || action.error) && (
        <Notice error>{resource.error?.message || action.error}</Notice>
      )}
      {resource.loading && <Loading />}
      {stats && (
        <>
          <div className="status-line">
            <span
              className={
                'status-dot' +
                (stats.paused
                  ? ' paused'
                  : stats.projects.some((project) => project.active)
                    ? ' active'
                    : '')
              }
            />
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
              <Icon name={stats.paused ? 'play' : 'pause'} width={16} height={16} />
              {stats.paused ? 'Resume account time' : 'Pause account time'}
            </button>
          </div>
          {!stats.projects.length ? (
            <section className="welcome-panel">
              <div>
                <p className="eyebrow">Your trail starts here</p>
                <h2>Big ideas start with a little work.</h2>
                <p>
                  Connect your editor and build something you care about. HackTrail keeps a record
                  of the work along the way, even when you’re offline.
                </p>
                <button className="primary" onClick={() => navigate('/connections')}>
                  <Icon name="connect" /> Connect your editor
                </button>
              </div>
              <ol className="setup-steps">
                <li>
                  <span>
                    <Icon name="download" />
                  </span>
                  Install the VS Code extension
                </li>
                <li>
                  <span>
                    <Icon name="shield" />
                  </span>
                  Choose what to collect
                </li>
                <li>
                  <span>
                    <Icon name="connect" />
                  </span>
                  Connect your account
                </li>
              </ol>
            </section>
          ) : null}
          <Stats stats={stats} />
          <div className="rhythm-layout">
            <section className="panel rhythm-panel">
              <div className="section-heading">
                <div>
                  <h2>Your rhythm</h2>
                  <p className="small muted">
                    Editor activity · {profile.timezone.replaceAll('_', ' ')}
                  </p>
                </div>
                <span className="chart-legend">
                  <span />
                  Editor time
                </span>
              </div>
              <WeekChart daily={stats.daily} />
            </section>
            <DailyGoal
              minutes={profile.dailyGoalMinutes}
              totalMs={stats.daily.at(-1)?.totalMs ?? 0}
              onSettings={() => navigate('/settings')}
            />
          </div>
          <div className="work-layout">
            <section className="panel projects-panel">
              <div className="section-heading">
                <div>
                  <h2>On your workbench</h2>
                  <p className="small muted">Projects in progress</p>
                </div>
                <button className="text-button" onClick={() => navigate('/projects')}>
                  All projects
                </button>
              </div>
              {stats.projects.some((project) => !project.archived) ? (
                <ProjectRows
                  projects={stats.projects.filter((project) => !project.archived).slice(0, 6)}
                  onOpen={(id) => navigate('/projects/' + id)}
                />
              ) : (
                <div className="projects-placeholder">
                  <Icon name="folder" width={32} height={32} />
                  <h3>
                    {stats.projects.length
                      ? 'Room for your next idea.'
                      : 'Your work will find a home here.'}
                  </h3>
                  <p className="muted">Projects appear automatically when activity syncs.</p>
                </div>
              )}
            </section>
            <div className="breakdown-stack">
              <Breakdown title="Languages" values={stats.languages} />
              <Breakdown title="Editors" values={stats.editors} />
            </div>
          </div>
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

function DailyGoal({
  minutes,
  totalMs,
  onSettings,
}: {
  minutes: number;
  totalMs: number;
  onSettings: () => void;
}) {
  const goalMs = minutes * 60_000;
  const progress = goalMs > 0 ? Math.min(100, Math.floor((totalMs / goalMs) * 100)) : 0;
  return (
    <section className="daily-goal">
      <div className="section-heading">
        <h2>A little every day</h2>
        <Icon name="clock" />
      </div>
      <p className="small">Your personal editor time goal</p>
      <div
        className="goal-dial"
        role="progressbar"
        aria-label="Today's goal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={
          goalMs ? durationLabel(totalMs) + ' of ' + durationLabel(goalMs) : 'No daily goal set'
        }
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="goal-track" cx="60" cy="60" r="52" />
          <circle
            className="goal-progress"
            cx="60"
            cy="60"
            r="52"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
            strokeOpacity={progress > 0 ? 1 : 0}
          />
        </svg>
        <span aria-hidden="true">
          {goalMs > 0 ? (
            <strong>
              {progress}
              <small>%</small>
            </strong>
          ) : (
            <Icon name="clock" width={30} height={30} />
          )}
          <span>{goalMs > 0 ? 'of today’s goal' : 'No goal set'}</span>
        </span>
      </div>
      <strong className="goal-total">
        {durationLabel(totalMs)}
        {goalMs > 0 && <span> / {durationLabel(goalMs)}</span>}
      </strong>
      <p className="small">
        {goalMs === 0
          ? 'Choose a goal that fits your day.'
          : progress === 100
            ? 'You reached your goal today.'
            : 'One session at a time.'}
      </p>
      <button className="text-button" onClick={onSettings}>
        {goalMs ? 'Adjust goal' : 'Set a daily goal'}
      </button>
    </section>
  );
}
