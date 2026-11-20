import { kindLabels, type ActivityEvent } from '../../src/shared/events.js';
import { Icon } from './icons.js';

export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function eventDescription(event: ActivityEvent) {
  if (event.metadata.excerpt) return event.metadata.excerpt;
  if (event.metadata.toolName) return event.metadata.toolName;
  if (event.kind === 'tool_result') {
    if (event.metadata.success === false) return 'The tool reported an error.';
    if (event.metadata.success === true) return 'The tool reported success.';
    return 'A tool result was recorded.';
  }
  return 'Message content was not imported.';
}

export function Timeline({
  events,
  selectedId,
  onSelect,
}: {
  events: ActivityEvent[];
  selectedId?: string;
  onSelect: (event: ActivityEvent) => void;
}) {
  return (
    <div className="event-list">
      {events.map((event, index) => {
        const day = dateLabel(event.occurredAt);
        const previous = events[index - 1];
        return (
          <div key={event.id}>
            {(!previous || dateLabel(previous.occurredAt) !== day) && (
              <div className="date-heading">
                <span>{day}</span>
                <span>Local time</span>
              </div>
            )}
            <button
              className={'event-row ' + (selectedId === event.id ? 'selected' : '')}
              onClick={() => onSelect(event)}
              aria-label={'Inspect ' + kindLabels[event.kind]}
            >
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </time>
              <span className={'event-node ' + event.actor}>
                <Icon
                  name={
                    event.actor === 'tool' ? 'code' : event.actor === 'user' ? 'arrow' : 'trail'
                  }
                  width="15"
                  height="15"
                />
              </span>
              <span className="event-content">
                <span className="event-title">
                  {kindLabels[event.kind]}
                  <span className={'actor-pill ' + event.actor}>{event.actor}</span>
                </span>
                <span className="event-description">{eventDescription(event)}</span>
                <span className="event-source">
                  {event.source}
                  {event.evidence ? ' / ' + event.evidence.fileName : ''}
                </span>
              </span>
              <Icon name="arrow" className="row-arrow" width="16" height="16" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function EvidencePanel({ event, onClose }: { event: ActivityEvent; onClose: () => void }) {
  return (
    <aside className="evidence-panel" aria-label="Event details">
      <div className="evidence-heading">
        <span className="eyebrow">RECORDED EVIDENCE</span>
        <button className="icon-button" onClick={onClose} aria-label="Close event details">
          <Icon name="close" />
        </button>
      </div>
      <span className={'actor-pill ' + event.actor}>{event.actor}</span>
      <h2>{kindLabels[event.kind]}</h2>
      <p className="muted small">
        The actor describes the source record. It does not verify human presence or authorship.
      </p>
      <dl>
        <dt>Source</dt>
        <dd>{event.source}</dd>
        <dt>Recorded at</dt>
        <dd>{new Date(event.occurredAt).toLocaleString()}</dd>
        {event.evidence && (
          <>
            <dt>Original record</dt>
            <dd>
              {event.evidence.fileName}
              <br />
              Line {event.evidence.line}, block {event.evidence.block + 1}
            </dd>
          </>
        )}
        {event.metadata.toolName && (
          <>
            <dt>Tool</dt>
            <dd>{event.metadata.toolName}</dd>
          </>
        )}
        {event.metadata.callId && (
          <>
            <dt>Tool call ID</dt>
            <dd className="mono">{event.metadata.callId}</dd>
          </>
        )}
      </dl>
      {event.metadata.excerpt && (
        <div className="excerpt">
          <span className="eyebrow">SAVED EXCERPT</span>
          <p>{event.metadata.excerpt}</p>
        </div>
      )}
      <details>
        <summary>View event JSON</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>
    </aside>
  );
}
