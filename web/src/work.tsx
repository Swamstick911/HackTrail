import { useState } from 'react';
import type { TrackingReport, TimeSlice } from '../../src/shared/tracking.js';
import { durationLabel } from '../../src/shared/tracking.js';
import type { ActivityReview } from '../../src/shared/review.js';
import { Icon } from './icons.js';
import { api, errorMessage } from './api.js';

export interface WorkData {
  tracking: TrackingReport;
  review: ActivityReview;
}

export function weekDays(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: 7 }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() - 6 + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      start: start.getTime(),
      end: end.getTime(),
      label: start.toLocaleDateString(undefined, { weekday: 'short' }),
    };
  });
}

export function timeInRange(slices: TimeSlice[], start: number, end: number) {
  return slices.reduce(
    (total, slice) =>
      total +
      Math.max(
        0,
        Math.min(end, Date.parse(slice.endedAt)) - Math.max(start, Date.parse(slice.startedAt)),
      ),
    0,
  );
}

function workSessions(slices: TimeSlice[]) {
  const groups: { start: string; end: string; duration: number; samples: TimeSlice[] }[] = [];
  for (const slice of slices) {
    const last = groups.at(-1);
    const duration = Date.parse(slice.endedAt) - Date.parse(slice.startedAt);
    if (last && Date.parse(slice.startedAt) - Date.parse(last.end) <= 60_000) {
      last.end = slice.endedAt;
      last.duration += duration;
      last.samples.push(slice);
    } else groups.push({ start: slice.startedAt, end: slice.endedAt, duration, samples: [slice] });
  }
  return groups.reverse();
}

function clockLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function TodayView({
  data,
  projectId,
  onConnect,
  onPolicy,
  onUpdated,
}: {
  data: WorkData;
  projectId: string;
  onConnect: () => void;
  onPolicy: () => void;
  onUpdated: () => void;
}) {
  const days = weekDays();
  const today = days[6]!;
  const totals = days.map((day) => timeInRange(data.tracking.slices, day.start, day.end));
  const highest = Math.max(...totals, 60_000);
  const sessions = workSessions(
    data.tracking.slices.filter((slice) => Date.parse(slice.endedAt) > today.start),
  );
  const active = data.tracking.clients.some((client) => client.state === 'active');
  const connected = data.tracking.clients.some((client) => client.state !== 'disconnected');
  const state = data.tracking.paused
    ? 'Tracking paused'
    : active
      ? 'Tracking editor activity'
      : connected
        ? 'Editor connected, currently idle'
        : 'Waiting for your editor';

  return (
    <>
      <div className="overview-grid">
        <section className="time-card" aria-label="Today's tracked time">
          <div className="section-line">
            <span className="metric-label">Editor time today</span>
            <button className="text-button" onClick={onPolicy}>
              How is this counted?
            </button>
          </div>
          <div className="time-number" data-testid="today-time">
            {durationLabel(totals[6]!)}
          </div>
          <div className={'tracking-state ' + (active && !data.tracking.paused ? 'active' : '')}>
            <span className="status-dot" />
            {state}
          </div>
          <div className="time-card-bottom">
            <span>
              <strong>{sessions.length}</strong> {sessions.length === 1 ? 'session' : 'sessions'}{' '}
              today
            </span>
            <span>Activity estimate</span>
          </div>
        </section>
        <section className="week-card" aria-label="This week's editor time">
          <div className="section-line">
            <h2>This week</h2>
            <strong>{durationLabel(data.tracking.totalMs)}</strong>
          </div>
          <div
            className="week-chart"
            role="img"
            aria-label={days
              .map((day, index) => day.label + ': ' + durationLabel(totals[index]!))
              .join(', ')}
          >
            {days.map((day, index) => (
              <div
                className={'chart-day ' + (index === 6 ? 'today' : '')}
                key={day.start}
                title={day.label + ': ' + durationLabel(totals[index]!)}
              >
                <div className="bar-track">
                  <span
                    className="chart-bar"
                    style={{
                      height: totals[index]
                        ? Math.max(5, (totals[index]! / highest) * 100) + '%'
                        : '0%',
                    }}
                  />
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
          <p className="small muted">Time from your connected editor. Agent runtime is separate.</p>
        </section>
      </div>
      <div className="work-grid">
        <div>
          <section className="panel session-panel">
            <div className="panel-heading">
              <h2>Today's work</h2>
              <span className="muted small">Saved as you go</span>
            </div>
            {sessions.length ? (
              <div className="session-list">
                {sessions.slice(0, 12).map((session) => (
                  <details className="session-row" key={session.start}>
                    <summary>
                      <span className="session-icon">
                        <Icon name="code" />
                      </span>
                      <span className="session-description">
                        <strong>Working in VS Code</strong>
                        <span>
                          {clockLabel(session.start)} to {clockLabel(session.end)}
                        </span>
                      </span>
                      <strong className="session-duration">
                        {durationLabel(session.duration)}
                      </strong>
                      <Icon name="chevron" width="16" height="16" />
                    </summary>
                    <div className="session-details">
                      <p>
                        {session.samples.length} activity samples. Gaps are excluded from the total.
                      </p>
                      <dl>
                        <dt>Started</dt>
                        <dd>{new Date(session.start).toLocaleString()}</dd>
                        <dt>Last sample</dt>
                        <dd>{new Date(session.end).toLocaleString()}</dd>
                        <dt>Counting rule</dt>
                        <dd>Editor input, 2 minute idle cutoff</dd>
                      </dl>
                      <p className="small muted">
                        Sample references are included in your project export.
                      </p>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="empty-work">
                <span className="empty-icon">
                  <Icon name="clock" width="28" height="28" />
                </span>
                <h3>A fresh day of making things.</h3>
                <p>
                  Connect VS Code, open your project, and start working. Your sessions will appear
                  here.
                </p>
                <button onClick={onConnect}>Connect VS Code</button>
              </div>
            )}
          </section>
          <Notes projectId={projectId} notes={data.review.notes} onUpdated={onUpdated} />
        </div>
        <aside className="work-aside">
          <section className="panel connections-card">
            <div className="panel-heading">
              <h2>Connected tools</h2>
              <button className="icon-button" aria-label="Manage connections" onClick={onConnect}>
                <Icon name="plus" />
              </button>
            </div>
            <div className="tool-row">
              <span className="tool-symbol editor">
                <Icon name="code" />
              </span>
              <div>
                <strong>VS Code</strong>
                <span>
                  {data.tracking.paused
                    ? 'Paused'
                    : active
                      ? 'Tracking'
                      : connected
                        ? 'Connected'
                        : 'Not connected'}
                </span>
              </div>
              {connected && <Icon name="check" className="connected-check" />}
            </div>
            <div className="tool-row">
              <span className="tool-symbol claude">
                <Icon name="activity" />
              </span>
              <div>
                <strong>Claude Code</strong>
                <span>
                  {data.review.lastHookAt
                    ? 'Last event ' + clockLabel(data.review.lastHookAt)
                    : 'No events yet'}
                </span>
              </div>
            </div>
            <button className="full-width" onClick={onConnect}>
              Manage connections
            </button>
          </section>
          <section className="agent-note">
            <span className="tool-symbol claude">
              <Icon name="activity" />
            </span>
            <h3>Agent work has its own clock.</h3>
            <p>
              <strong>{durationLabel(data.review.agentMs)}</strong> recorded this week across{' '}
              {data.review.closedRuns} completed runs.
            </p>
            <p className="small muted">This is kept separate from your editor time.</p>
          </section>
          <p className="local-note">
            <Icon name="shield" width="16" height="16" />
            Stored on this device. You choose what to share.
          </p>
        </aside>
      </div>
    </>
  );
}

function Notes({
  projectId,
  notes,
  onUpdated,
}: {
  projectId: string;
  notes: ActivityReview['notes'];
  onUpdated: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await api('/projects/' + projectId + '/notes', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setText('');
      onUpdated();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel notes-panel">
      <div className="panel-heading">
        <h2>A little context</h2>
        <Icon name="note" />
      </div>
      <p className="muted">What changed? What did you figure out? Leave a note for future you.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="sr-only" htmlFor="work-note">
          Work note
        </label>
        <textarea
          id="work-note"
          maxLength={500}
          rows={3}
          placeholder="What did you work on?"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="note-actions">
          <span className="small muted">{text.length}/500</span>
          <button disabled={!text.trim() || saving}>{saving ? 'Saving...' : 'Save note'}</button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notes.length > 0 && (
        <div className="saved-notes">
          {notes.map((note) => (
            <article key={note.id}>
              <p>{note.metadata.excerpt}</p>
              <time dateTime={note.occurredAt}>{new Date(note.occurredAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReviewView({
  data,
  onExport,
  onPolicy,
  busy,
}: {
  data: WorkData;
  onExport: () => void;
  onPolicy: () => void;
  busy: boolean;
}) {
  const review = data.review;
  return (
    <section className="panel review-panel">
      <div className="review-heading">
        <span className="review-mark">
          <Icon name="review" width="28" height="28" />
        </span>
        <div>
          <h2>Your week, with the context.</h2>
          <p>A draft record of the last seven days.</p>
        </div>
        <span className="pill">Local record</span>
      </div>
      <div className="review-metrics">
        <div>
          <span>Estimated editor time</span>
          <strong>{durationLabel(data.tracking.totalMs)}</strong>
        </div>
        <div>
          <span>Agent runtime</span>
          <strong>{durationLabel(review.agentMs)}</strong>
        </div>
        <div>
          <span>Recorded events</span>
          <strong>{review.eventCount}</strong>
        </div>
      </div>
      <section className="review-section">
        <h3>What the record shows</h3>
        <p>
          {review.userMessages} user messages, {review.toolCalls} tool calls, and{' '}
          {review.closedRuns} completed agent runs.
        </p>
        <p>
          {review.sources.length
            ? 'Activity from ' + review.sources.join(', ') + '.'
            : 'No activity has been collected in this period yet.'}
        </p>
        {review.notes.length > 0 && <blockquote>{review.notes[0]?.metadata.excerpt}</blockquote>}
      </section>
      <section className="review-section">
        <h3>Things to review</h3>
        <ul className="review-checks">
          <li>
            {review.failedTools
              ? review.failedTools +
                ' tool results reported errors. Inspect the activity for context.'
              : 'No failed tool results were recorded in this period.'}
          </li>
          <li>
            {review.incompleteRuns
              ? review.incompleteRuns +
                ' agent runs have no matching finish. Their duration is excluded.'
              : 'Only paired start and finish events contribute to agent runtime.'}
          </li>
          <li>
            Editor time is an activity estimate. Reading, thinking, and work outside the editor may
            be missing.
          </li>
          <li>
            Local records can be edited. This export does not verify authorship or approve bounty
            hours.
          </li>
        </ul>
      </section>
      <div className="review-footer">
        <button className="text-button" onClick={onPolicy}>
          Read the counting rules
        </button>
        <button className="primary" disabled={busy} onClick={onExport}>
          <Icon name="download" />
          Export project record
        </button>
      </div>
      <p className="small muted">
        The export includes the full project history, time samples, and counting policy.
      </p>
    </section>
  );
}
