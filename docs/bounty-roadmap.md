# Bounty roadmap

HackTrail should become a useful daily record for people building with AI, with hours that reviewers can inspect. The target is productive struggle. Editor activity, agent runtime, typing patterns, and commit counts do not establish that by themselves.

## This increment: 0.4

- Keep passive editor collection, idle handling, offline replay, and project switching.
- Add Claude and Codex lifecycle adapters with a shared installer and delivery queue.
- Attach the last observed Git commit and branch to editor samples. Show checkpoints to help builders resume work.
- Separate editor activity, agent runtime, and their overlap. Preserve uncertainty about reading, testing, and unobserved AI tools.
- Keep metadata local and require consent before expanding an existing installation's collection.

These are implementation milestones, not validation of productive-struggle hours.

## Next: validate the estimate

Recruit a small, consented pilot before introducing a credited-hours score. Include short prompt/read/test loops, debugging, planning, unattended agent runs, browser-assisted work, project switching, sleep, and offline recovery.

For each session, collect a participant's explanation of what they tried and learned, the observed signals, and an independent review using a rubric agreed with the bounty owner. Do not treat historical hour reductions as clean labels. Reviewers may disagree, and missing observations should remain visible.

Compare alternative counting policies against that reference. Report absolute time error, missed work, excess counted time, reviewer disagreement, and results per workflow. Freeze a policy before evaluating it on different sessions. Keep policy versions and original evidence so a changed rule can be reproduced.

Measure startup time, CPU, memory, queue size, and delivery reliability on the Dell Inspiron 5775 with 8 GB RAM and SSD. Cross-platform CI does not substitute for this device check.

## Then: central service and sharing

Build accounts, projects, public-by-default profiles, Git repository links, and real-time statistics around the validated local record. Public project summaries and selected-hour submissions need a different disclosure policy from the detailed local log. Preview exactly what will be shared, including branch names and optional notes.

Add selected-hour evidence bundles that another reviewer can reproduce without trusting a summary. Commit identity and local logs remain editable evidence, not proof of authorship. Measure whether the evidence reduces review effort without increasing incorrect decisions.

## Adoption and acceptance

Continue adapter support through the common event contract. Cover more popular AI tools and editors according to pilot usage, while keeping unknown activity explicit.

Load-test the central service against the stated 15,488 monthly active users and 109,759 monthly hours. Publish measurements and a cost model against the $500 monthly limit before claiming the scaling requirement.

The adoption target is 1,000 weighted projects in UnifiedProjectsDB under the bounty's rules. Installs, local test fixtures, and synthetic records do not meet that target. Confirm the current weighting and acceptance rules with the organizer before the submission push.

AGPLv3, low-spec support, useful personal feedback, privacy, auditable hours, broad adapters, the central service, and adoption all remain part of the goal. Review speed is an outcome to measure, not a replacement for those requirements.
