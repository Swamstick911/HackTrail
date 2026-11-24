import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../web/src/icons.js';
import { durationLabel } from '../../src/shared/tracking.js';
import type { Dashboard } from '../../src/platform/analytics.js';
export { Icon, durationLabel };

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" /> Loading your workspace...
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="muted header-description">{children}</div>}
      </div>
      {action && <div className="header-action">{action}</div>}
    </header>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="trail" width={28} height={28} />
      </span>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
      {action}
    </div>
  );
}
export function Stats({ stats }: { stats: Pick<Dashboard, 'totalMs' | 'agentMs' | 'overlapMs'> }) {
  return (
    <div className="stats-grid">
      <div className="stat-primary">
        <p>
          <Icon name="clock" />
          Editor activity
        </p>
        <strong>{durationLabel(stats.totalMs)}</strong>
        <span>Time recorded while working</span>
      </div>
      <div>
        <p>
          <Icon name="code" />
          Agent runtime
        </p>
        <strong>{durationLabel(stats.agentMs)}</strong>
        <span>Completed, observed agent runs</span>
      </div>
      <div>
        <p>
          <Icon name="overlap" />
          Time in common
        </p>
        <strong>{durationLabel(stats.overlapMs)}</strong>
        <span>Already included in both clocks</span>
      </div>
    </div>
  );
}
export function WeekChart({ daily }: { daily: Dashboard['daily'] }) {
  const groupId = useId();
  const [selectedDate, setSelectedDate] = useState('');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selected = daily.find((day) => day.date === selectedDate) ?? daily.at(-1);
  const activeDate = selected?.date;
  const inspected = daily.find((day) => day.date === hoveredDate) ?? selected;
  const maximum = Math.ceil(Math.max(60_000, ...daily.map((day) => day.totalMs)) / 60_000) * 60_000;
  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const column = container?.querySelector('input:checked')?.parentElement;
    if (!container || !column) return;
    const left = column.getBoundingClientRect().left - container.getBoundingClientRect().left;
    if (left < 0) container.scrollLeft += left;
    else if (left + column.clientWidth > container.clientWidth)
      container.scrollLeft += left + column.clientWidth - container.clientWidth;
  }, [activeDate, daily.length]);
  if (!inspected) return <p className="panel-empty muted">No days in this period.</p>;
  return (
    <div className="activity-chart">
      <div className="chart-readout">
        <div>
          <strong>{durationLabel(inspected.totalMs)}</strong>
          <time dateTime={inspected.date}>
            {dateLabel(inspected.date, { month: 'short', day: 'numeric' })}
          </time>
        </div>
        <span className="chart-hint">Select a day to explore</span>
      </div>
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden="true">
          <span>{durationLabel(maximum)}</span>
          <span>{durationLabel(maximum / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-scroll" ref={scrollRef}>
          <fieldset
            className={'week-chart' + (daily.length > 7 ? ' month-chart' : '')}
            onMouseLeave={() => setHoveredDate(null)}
          >
            <legend className="sr-only">Daily editor activity</legend>
            {daily.map((day) => (
              <label
                className="day-column"
                key={day.date}
                onMouseEnter={() => setHoveredDate(day.date)}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={groupId}
                  checked={selected?.date === day.date}
                  onChange={() => {
                    setSelectedDate(day.date);
                    setHoveredDate(null);
                  }}
                  onFocus={() => setHoveredDate(null)}
                  aria-label={
                    dateLabel(day.date, { dateStyle: 'full' }) + ', ' + durationLabel(day.totalMs)
                  }
                />
                <span className="bar-track">
                  <span className="bar" style={{ height: (day.totalMs / maximum) * 100 + '%' }} />
                </span>
                <span className="day-label">
                  {dateLabel(
                    day.date,
                    daily.length > 7 ? { day: 'numeric' } : { weekday: 'short' },
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
export function Breakdown({
  title,
  values,
}: {
  title: string;
  values: { name: string; totalMs: number }[];
}) {
  const total = values.reduce((sum, item) => sum + item.totalMs, 0);
  return (
    <section className="panel breakdown-panel">
      <div className="section-heading">
        <h2>{title}</h2>
        <Icon name={title === 'Languages' ? 'code' : 'connect'} />
      </div>
      {values.length ? (
        <ul className="breakdown">
          {values.slice(0, 8).map((item) => (
            <li key={item.name}>
              <div>
                <span>{item.name}</span>
                <span className="muted">{durationLabel(item.totalMs)}</span>
              </div>
              <progress value={item.totalMs} max={Math.max(1, total)} aria-label={item.name} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted panel-empty">Details appear when your editor sends activity.</p>
      )}
    </section>
  );
}
export function ProjectRows({
  projects,
  onOpen,
}: {
  projects: Dashboard['projects'];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="project-rows">
      {projects.map((project) => (
        <div className="project-row" key={project.id}>
          <span
            className={'project-symbol project-color-' + (project.name.charCodeAt(0) % 4)}
            aria-hidden="true"
          >
            {project.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="project-info">
            {onOpen ? (
              <button className="text-button project-title" onClick={() => onOpen(project.id)}>
                {project.name}
              </button>
            ) : (
              <strong>{project.name}</strong>
            )}
            <span className="muted small">
              {project.description ||
                (project.repositoryUrl
                  ? new URL(project.repositoryUrl).hostname
                  : 'A work in progress')}
              {project.archived ? ' · Archived' : ''}
            </span>
          </div>
          <span className="pill">{project.visibility}</span>
          <strong className="time-label">{durationLabel(project.totalMs)}</strong>
        </div>
      ))}
    </div>
  );
}
