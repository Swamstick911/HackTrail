# UI design decisions

The first interface gave event counts more prominence than the user's work. It used small, low-contrast metadata, repeated promotional copy, and made live tracking impossible to discover because the feature did not exist yet.

The redesign starts with three everyday questions: what did I work on today, what happened, and what can I show someone reviewing it?

## Research applied

| Guidance                                                                                                   | Application                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Nielsen Norman Group: visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Make today's editor time and connection state prominent. Group the weekly context separately from detailed events.                                         |
| [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)   | Put JSON, individual source references, and counting-policy details behind deliberate inspection. Keep the normal work view focused on sessions and notes. |
| [W3C: minimum contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)                 | Use dark body text, readable secondary text, and a restrained accent color. Avoid the faint green text in the original version.                            |
| [W3C: target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)                   | Give common controls comfortable hit areas, preserve keyboard focus outlines, and use a compact mobile navigation bar.                                     |

These sources inform the design; automated checks and screenshots do not establish complete WCAG conformance or substitute for testing with users.

## Product choices

- Today shows saved time, not a decorative counter that keeps running without evidence.
- Agent time appears separately with an explanation.
- The empty state leads to creating a project and connecting VS Code.
- New projects open the setup flow automatically.
- The main views are Today, Activity, and Review.
- Work notes let the builder explain work the tracker cannot observe.
- Failure counts describe tool results; they do not claim that tests passed or failed.
- The weekly chart uses recorded intervals, with zero bars for days without samples.
- Connection state comes from actual heartbeats. A stale editor becomes disconnected after 45 seconds.
- Desktop and 390 px mobile layouts use the same functions and data.

The next design validation is a short usability session: install the extension, connect a workspace, find a recorded session, pause collection, explain an idle gap, and export the record without assistance.
