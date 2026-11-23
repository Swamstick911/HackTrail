# Bounty roadmap

HackTrail should become a useful daily record for people building with AI, with hours that reviewers can inspect. The target is productive struggle. Editor activity, agent runtime, typing patterns, and commit counts do not establish that by themselves.

## Acceptance update: November 23, 2026

The organizer discussion shared by Swamstick says there is no fixed deadline: the first qualifying tracker to reach 1,000 weighted projects in the unified database wins. Program organizers adopt the method, participants submit projects using it, and accepted work reaches the database through the program's submission process.

The discussion gives 10,000 hours approved by both the YSWS program and quality/integrity (Q&I) as equivalent to 1,000 weighted projects. This is the working planning conversion, not a complete weighting specification. Confirm caps, exclusions, attribution to HackTrail, and how corrections affect the total before displaying an official progress counter.

The same discussion says Q&I can fine the YSWS program when approved work fails its checks. Problems caught earlier by reviewers or Fraud Squad do not count toward weighted projects until fixed. We should help organizers produce reviewable evidence and correct problems before approval; HackTrail cannot guarantee approval or make a Q&I decision itself.

This clarification changes the order of work. Recruit an organizer and validate a small submission flow while completing the software. The other bounty requirements still apply.

## Shipped: 0.4

- Passive editor collection, idle handling, offline replay, and project switching.
- Claude and Codex lifecycle adapters with a shared installer and delivery queue.
- Observed Git commits and branches attached to editor samples, plus checkpoints to resume work.
- Separate editor activity, agent runtime, and their overlap.
- Local metadata storage and consent before expanding an existing installation's collection.

These are implementation milestones, not validation of productive-struggle hours. The current export contains the full project history; it is not yet a selected-hour submission package. There is no central account service, program integration, or authoritative weighted-project counter.

## Next release: an organizer can inspect one submission

Build a selected-period evidence package before adding more general dashboard features. A participant should be able to:

1. Identify the project and provide its repository and demo links.
2. Select the time range being submitted and preview the exact information included.
3. Include relevant Git checkpoints and optional notes about attempts, tests, decisions, and unresolved problems.
4. Export a readable summary and versioned machine-readable evidence that reproduce the measured intervals, counting rules, overlaps, and missing boundaries.
5. Keep estimated editor time, agent runtime, and any participant claim distinct. None is prefilled as approved productive-struggle time.

The export must exclude activity outside the selection, unrelated project data, credentials, and unselected note text. Required start/stop context crossing the boundary must be explicitly shown in the preview, with reported time clipped to the selected range. Re-exporting the same evidence should preserve stable references so reviewers can detect duplicate claims; identifiers and checksums do not prove authorship.

Keep this usable as a local file first. Choose the first program-specific import or hosted sharing flow after an organizer confirms their requirements. Do not invent a direct Unified write API or ask participants for program credentials.

A useful implementation reference is [Scare's program submission adapter](https://github.com/hackclub/scare/blob/main/src/server/airtable.ts), inspected on November 23. It mirrors project records into the program's Airtable submission table, includes alternate tracking evidence, and leaves the Unified submission control to a person. This demonstrates one program's workflow, not official acceptance of HackTrail or a universal integration contract.

## Organizer pilot, alongside implementation

Start with one willing program and a small cohort, initially five to ten consenting builders. Use the program's required tracker alongside HackTrail until the organizer explicitly accepts the new method. Comparison sessions are research; do not count their hours toward the bounty without confirmed eligibility and attribution.

Agree on these points before relying on pilot submissions:

- Which work is eligible under the program's AI policy and productive-struggle rubric?
- What evidence does its reviewer need, and where should the report fit into the current submission form?
- Who approves the method, records accepted hours, and submits the project to Unified?
- What establishes Q&I approval, and how are rejected or revised hours reconciled?
- How will the bounty owner attribute qualifying hours to HackTrail and prevent duplicate credit across trackers, revisions, or programs?

The first adoption milestone is one organizer agreeing to evaluate the format. The next is one real project completing the program's review and database workflow with confirmed eligibility. Then expand within that program and use the observed results when approaching another organizer.

No outreach has been sent and no program has agreed to a pilot. A possible message for the user to send once the export is demonstrable:

> I'm building HackTrail, an AGPL tracker for work with AI. It already records local editor activity, Claude/Codex runtime, and Git context. I'm adding a selected-period report your reviewers can inspect. Would you help shape a small pilot alongside your existing process? I'd like to compare the evidence and review effort before asking you to accept its hours officially.

## Validate time and review effort

Include short prompt/read/test loops, debugging, planning, unattended agent runs, browser-assisted work, project switching, sleep, and offline recovery.

For each session, collect the participant's explanation, observed signals, and an independent review using an agreed rubric. Historical hour reductions are not clean training labels. Reviewer disagreement and missing observations should stay visible.

Compare candidate counting policies with that reference. Report absolute time error, missed work, excess counted time, and results per workflow. Freeze a policy before evaluating it on different sessions. Keep policy versions and original evidence so decisions can be reproduced.

Record installation success, time to first recorded session, review minutes per submission, clarification requests, approved hours, and subsequent corrections. A faster review is useful only if its decisions remain reliable. Set pilot expansion criteria with the organizer after measuring a baseline, rather than promising a speedup now.

Measure startup time, CPU, memory, queue size, and delivery reliability on the Dell Inspiron 5775 with 8 GB RAM and SSD. Cross-platform CI does not substitute for this device check.

## Central service and wider adoption

Build accounts, projects, public-by-default profiles, remote Git links, and real-time statistics around the validated record and the first program's submission needs. Public project summaries need a different disclosure policy from detailed local evidence. Preview what will be shared, including branch names and optional notes.

Keep observed hours, participant claims, program-approved hours, Unified records, and Q&I outcomes distinct. Database presence alone must not imply Q&I acceptance. An official progress total must derive from the confirmed external records, including revisions and removals. A local checkbox cannot establish official eligibility.

For capacity planning, 500 qualifying submissions averaging 20 jointly approved hours would total 10,000 hours. This is arithmetic using the shared conversion, not an adoption forecast or a claim that every submission receives that credit.

Continue adapter support according to pilot usage while keeping unknown activity explicit. Load-test the central service against the stated 15,488 monthly active users and 109,759 monthly hours. Publish measurements and a cost model against the $500 monthly limit before claiming the scaling requirement.

AGPLv3, low-spec support, useful personal feedback, privacy, auditable hours, broad adapters, the central service, and qualifying adoption all remain part of the goal. The immediate priority is a trustworthy submission that a real organizer can use.
