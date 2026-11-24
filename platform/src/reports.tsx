import { useState } from 'react';
import type { EvidenceReport, ReportOptions } from '../../src/platform/reports.js';
import type { PlatformProject } from '../../src/platform/store.js';
import { kindLabels } from '../../src/shared/events.js';
import { api, downloadJson, useAction, useResource } from './api.js';
import { Empty, Icon, Loading, Notice, PageHeader, Stats, durationLabel } from './components.js';

export function ReportView({ report }: { report: EvidenceReport }) {
  const [limit, setLimit] = useState(30);
  return (
    <div className="report-view">
      <div className="report-heading">
        <span className="eyebrow">Project evidence · snapshot</span>
        <h2>{report.project.name}</h2>
        <p className="muted">
          {new Date(report.range.from).toLocaleString()} to{' '}
          {new Date(report.range.to).toLocaleString()}
        </p>
        {report.project.description && <p>{report.project.description}</p>}
      </div>
      <Stats
        stats={{
          totalMs: report.tracking.totalMs,
          agentMs: report.review.agentMs,
          overlapMs: report.review.overlapMs,
        }}
      />
      <Notice>{report.notice}</Notice>
      <div className="two-columns">
        <section className="panel">
          <h3>What this report includes</h3>
          <ul className="plain-list">
            <li>Counted editor intervals and signal types</li>
            <li>Agent boundaries, tool names, and outcomes when available</li>
            <li>Git context: {report.disclosure.git ? 'included' : 'excluded'}</li>
            <li>Work notes: {report.disclosure.notes ? 'included' : 'excluded'}</li>
          </ul>
        </section>
        <section className="panel">
          <h3>Things to check</h3>
          <ul className="plain-list">
            <li>{report.review.incompleteRuns} incomplete agent runs</li>
            <li>{report.review.interruptedRuns} interrupted runs</li>
            <li>{report.review.failedTools} failed tool actions</li>
            <li>{report.review.closedRuns} completed runs</li>
          </ul>
          <p className="small muted">These are context for a review, not evidence of misconduct.</p>
        </section>
      </div>
      <p className="small muted">{report.disclosure.boundaryContext}</p>
      <section className="panel">
        <div className="section-heading">
          <h3>The project trail</h3>
          <span className="small muted">{report.events.length} events</span>
        </div>
        {report.events.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Activity</th>
                  <th>Context</th>
                </tr>
              </thead>
              <tbody>
                {report.events.slice(0, limit).map((event) => (
                  <tr key={event.id}>
                    <td>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </td>
                    <td>
                      {kindLabels[event.kind]}
                      <span className="small muted block">{event.source}</span>
                    </td>
                    <td>
                      {event.metadata.excerpt ??
                        event.metadata.toolName ??
                        event.metadata.git?.commit.slice(0, 8) ??
                        'Metadata only'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.events.length > limit && (
              <button onClick={() => setLimit((value) => value + 100)}>Show more events</button>
            )}
          </div>
        ) : (
          <p className="muted panel-empty">
            No agent, Git, or note events were included for this period.
          </p>
        )}
      </section>
      <details className="technical-details">
        <summary>Counting policy and report fingerprint</summary>
        <p className="small">
          Policy {report.policy.version}: direct editor samples use a two-minute idle cutoff and
          intervals up to 30 seconds. Heartbeat estimates join consecutive points up to two minutes
          apart. Parallel devices count once per account.
        </p>
        <p className="small">
          {report.tracking.slices.length} counted intervals. Editor total:{' '}
          {durationLabel(report.tracking.totalMs)}.
        </p>
        <code>{report.fingerprint}</code>
      </details>
    </div>
  );
}
export function ReportBuilder({ project }: { project: PlatformProject }) {
  const [preview, setPreview] = useState<{
    report: EvidenceReport;
    options: ReportOptions;
    days: number;
  } | null>(null);
  const [shared, setShared] = useState<{ url: string; expiresAt: string } | null>(null);
  const action = useAction();
  const [end] = useState(() =>
    new Date(Math.ceil(Date.now() / 1000) * 1000).toISOString().slice(0, 19),
  );
  const [start] = useState(() => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19));
  return (
    <>
      <section className="panel">
        <h2>A report you can stand behind</h2>
        <p className="muted">
          Choose a period and preview exactly what someone else will see. A link gives anyone who
          has it access until it expires or you revoke it.
        </p>
        {action.error && <Notice error>{action.error}</Notice>}
        <form
          onChange={() => {
            setPreview(null);
            setShared(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const options: ReportOptions = {
              range: {
                from: new Date(String(data.get('from')) + 'Z').toISOString(),
                to: new Date(String(data.get('to')) + 'Z').toISOString(),
              },
              includeGit: data.has('git'),
              includeNotes: data.has('notes'),
            };
            const days = Number(data.get('expiry'));
            void action.run(async () => {
              const report = await api<EvidenceReport>(
                '/projects/' + project.id + '/reports/preview',
                options,
              );
              setPreview({ report, options, days });
              setShared(null);
            });
          }}
        >
          <div className="two-columns">
            <label>
              From (UTC)
              <input type="datetime-local" step="1" name="from" defaultValue={start} required />
            </label>
            <label>
              To (UTC)
              <input type="datetime-local" step="1" name="to" defaultValue={end} required />
            </label>
          </div>
          <div className="two-columns">
            <label className="check-label">
              <input type="checkbox" name="git" />
              Include Git context
              <span className="field-help">Commit IDs, branches, and change counts.</span>
            </label>
            <label className="check-label">
              <input type="checkbox" name="notes" />
              Include work notes
              <span className="field-help">Your explanations written on this platform.</span>
            </label>
          </div>
          <label>
            Link expires after
            <select name="expiry" defaultValue="7">
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
          <button className="primary" disabled={action.busy}>
            <Icon name="review" />
            Preview report
          </button>
        </form>
      </section>
      {preview && (
        <>
          <div className="section-heading">
            <h2>Your disclosure preview</h2>
            <div className="actions">
              <button onClick={() => downloadJson(preview.report, 'hacktrail-report.json')}>
                <Icon name="download" />
                Download JSON
              </button>
              <button
                className="primary"
                disabled={action.busy || Boolean(shared)}
                onClick={() =>
                  void action.run(async () => {
                    const result = await api<{ url: string; expiresAt: string }>(
                      '/projects/' + project.id + '/reports',
                      {
                        ...preview.options,
                        expiresInDays: preview.days,
                        fingerprint: preview.report.fingerprint,
                      },
                    );
                    setShared(result);
                  })
                }
              >
                Create share link
              </button>
            </div>
          </div>
          {shared && (
            <Notice>
              <strong>Ready to share</strong>
              <label className="share-link">
                Report link
                <input
                  aria-label="Report link"
                  readOnly
                  value={shared.url}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <span className="small">
                Expires {new Date(shared.expiresAt).toLocaleString()}. Manage or revoke it from
                Reports.
              </span>
            </Notice>
          )}
          <ReportView report={preview.report} />
        </>
      )}
    </>
  );
}
interface SharedReportRow {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  expiresAt: number;
}
export function Reports({ navigate }: { navigate: (path: string) => void }) {
  const resource = useResource<SharedReportRow[]>('/reports');
  const action = useAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <>
      <PageHeader eyebrow="Share with intention" title="Your reports">
        A snapshot of a project, with just the context you choose.
      </PageHeader>
      {(resource.error || action.error) && (
        <Notice error>{resource.error?.message || action.error}</Notice>
      )}
      {resource.loading && <Loading />}
      <section className="panel">
        {resource.data?.length ? (
          <div className="report-list">
            {resource.data.map((report) => (
              <div className="report-row" key={report.id}>
                <Icon name="review" />
                <div>
                  <button
                    className="text-button"
                    onClick={() => navigate('/projects/' + report.projectId)}
                  >
                    {report.projectName}
                  </button>
                  <span className="small muted block">
                    Created {new Date(report.createdAt).toLocaleDateString()} ·{' '}
                    {report.expiresAt <= Date.now()
                      ? 'Expired'
                      : 'Expires ' + new Date(report.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                {confirm === report.id ? (
                  <div className="actions">
                    <button
                      className="danger"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api('/reports/' + report.id, undefined, 'DELETE');
                          setConfirm(null);
                          resource.refresh();
                        })
                      }
                    >
                      Confirm revoke
                    </button>
                    <button onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirm(report.id)}>Revoke</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Share the story behind a project."
            action={
              <button className="primary" onClick={() => navigate('/projects')}>
                Choose a project
              </button>
            }
          >
            Open a project, choose “Share a report”, and review the preview before creating a link.
          </Empty>
        )}
      </section>
      <p className="footnote">
        Links are only shown when created. They are stored as hashes on the server. Revoking access
        cannot remove copies someone has already downloaded.
      </p>
    </>
  );
}
export function PublicReport({ token }: { token: string }) {
  const resource = useResource<EvidenceReport>('/public/reports/' + encodeURIComponent(token));
  return (
    <>
      {resource.loading && <Loading />}
      {resource.error && <Notice error>{resource.error.message}</Notice>}
      {resource.data && (
        <>
          <PageHeader
            eyebrow="Shared with you"
            title="A closer look at the work"
            action={
              <button onClick={() => downloadJson(resource.data, 'hacktrail-report.json')}>
                <Icon name="download" />
                Download JSON
              </button>
            }
          >
            This is a fixed snapshot, not a live project feed.
          </PageHeader>
          <ReportView report={resource.data} />
        </>
      )}
    </>
  );
}
