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

## Shared platform redesign

The account workspace now uses a brighter work area, a navy navigation rail, and a stronger hierarchy. The previous interface gave nearly every panel the same color and emphasis. The change makes editor activity the main number, keeps agent runtime and overlap distinct, and puts the daily chart beside a personal goal. Project history, connections, settings, and shareable reports use the same controls and typography.

### Research and decisions

| Source                                                                                                           | What it informed                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)                | Simplify the surrounding navigation and establish consistent foundations across screens. Keep the existing destinations familiar.                        |
| [Nielsen Norman Group: visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)       | Use size, contrast, and grouping to prioritize editor time. Give the goal and project list different roles instead of repeating equally prominent boxes. |
| [Nielsen Norman Group: animation for usability](https://www.nngroup.com/articles/animation-usability/)           | Motion should communicate an interaction or state change. Avoid perpetual effects that compete with the work.                                            |
| [IBM Carbon: motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview)             | Use short, restrained transitions for controls, chart selection, and page entry. No animation library or continuous background animation is needed.      |
| [IBM Carbon: data visualization](https://www.carbondesignsystem.com/building-blocks/data-visualization/overview) | Keep the chart accurate and inspectable. Zero activity has zero bar height, all days use one scale, and the date and duration remain available as text.  |
| [W3C: contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)                               | Use dark readable text and check the main text/background pairs. Reserve small type for secondary information.                                           |
| [W3C: animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Disable nonessential animations and transitions with `prefers-reduced-motion`.                                                                           |
| [W3C: target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)                         | Common controls have at least 44 px height. Chart day targets have at least 24 px width, visible keyboard focus, and native radio keyboard behavior.     |

These are design decisions informed by the sources, not claims that a particular palette or layout is required by them.

### Visual system

- Keep HackTrail's existing mark and cobalt accent. Use navy for navigation and green for the personal goal.
- Serve one 24 KB Manrope variable font locally, with system fallbacks. No font service is contacted at runtime. Its SIL Open Font License is bundled in `platform/public/fonts/OFL.txt`.
- Use 16 px body text, 14 px control labels, and 12 to 13 px secondary metadata. Use tabular numerals for durations.
- Make project initials distinct, preserve clear visibility labels, and use icons to clarify actions.
- Use 160 to 240 ms transitions. Page entry moves only 5 px. The loading indicator stops animating after four turns; its status text stays visible.
- Keep the sign-in illustration as a simple SVG representing the work process. It contains no fabricated activity, user counts, or endorsements.

### Interaction and responsive behavior

The activity chart is a native radio group. Hover previews a date, clicking or tapping selects it, and arrow keys change the selection. Its readout uses the returned calendar dates, without interpreting them in the browser's time zone. Switching periods preserves a selected date when it remains available and otherwise selects the newest day. The 30-day chart scrolls horizontally within its panel to preserve readable labels and usable targets.

The daily goal counts editor time only. It shows actual recorded time alongside the goal and caps the progress ring at 100 percent. A disabled goal has a clear setup action. The goal never labels tracked time as program-approved hours.

On mobile, navigation becomes a horizontal row, the primary time card spans the width, and chart, goal, and project sections stack. Reduced motion disables all CSS animations and transitions. The tracker and counting rules are unchanged by this redesign.

### Validation

Browser coverage includes mouse, keyboard, touch, period changes, zero-activity days, goal navigation, reduced motion, and overflow checks from 320 px to 1440 px. Screenshots use disposable accounts and recorded test intervals, not the user's workspace data. Existing browser workflows still exercise account setup, editor approval, actual collector sync, privacy controls, reports, and deletion.

Visual inspection and automated tests do not establish full accessibility conformance. The next useful check is a short session with builders: connect an editor, find yesterday's work, explain the three clocks, and share a report without assistance.
