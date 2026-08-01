# AGENTS.md — Contract for Coding Agents & Models Running the Testbed

You are testing the `sf data360` CLI plugin. Your job: execute scenarios, record everything, and report honestly — including your own confusion (confusion is data: if the CLI misleads you, that's a DX bug we want).

## Protocol

1. **Start**: `node testbed/bin/testbed.mjs start --agent <your-name> --model <model-id> --mode mock` (live mode only if explicitly instructed AND `LIVE_TESTING.md` gates are set). Note the session directory it prints.
2. **Run suites**: `node testbed/bin/testbed.mjs run --suite smoke` (then any suites you were assigned). Do not edit suites mid-session.
3. **Investigate failures** with traced ad-hoc commands: `node testbed/bin/testbed.mjs exec -- sf data360 <…> --json`. Never run the CLI untraced during a session.
4. **Record observations** as you go: `node testbed/bin/testbed.mjs note --taxonomy <t> --severity <s> --text "…" --evidence <seq,seq>`.
5. **End**: `node testbed/bin/testbed.mjs end`. If `validate` fails, fix your artifacts (never hand-edit events — append corrections as notes).

Run only one suite at a time in a session. For an authorized existing live-verification ledger, use `node testbed/bin/testbed.mjs live-verify -- <options>` inside a live session so it shares the same trace.

## Note taxonomy (pick exactly one)

- `suspected-bug` — the CLI did something wrong (wrong exit code, wrong output, crash, contract violation). Requires: expected vs actual + evidence seqs.
- `suspected-misuse` — you did something wrong and the CLI let you / didn't guide you. Say what you expected to happen.
- `docs-gap` — help/README/examples missing or misleading for what you attempted.
- `dx-friction` — it worked but fought you (flag naming surprised you, output hard to parse, missing next-step hint).
- `question` — anything you couldn't classify.

## Rules

- **Evidence or it didn't happen**: every note and every claim in your final summary must cite event `seq` numbers.
- **Never bypass redaction**: don't echo tokens, org URLs, or usernames into notes; the validator will fail your session.
- **Live safety**: declarative `run` and exploratory `exec` accept only the reviewed read-only command allowlist. Use `live-verify` for an authorized mutation/billable scenario; its resolved scenario must pass the independent environment gates.
- **Don't fix the plugin mid-session**: you're a tester here. File findings; a different session does fixes.
- **Exit-code discipline**: treat exit 2 as parse error, 68 as partial completion, and 69 as still running; asserting these stable automation outcomes correctly is part of the job.
- **When a step fails**: try the error message's suggested action once (this measures whether our errors self-heal); record whether it recovered.

## Your final summary (write as `note --taxonomy question --severity info` before `end`, or as the session's closing note)

Three short lists, each item with evidence seqs: (1) broken or suspicious, (2) worked notably well, (3) confused you. No prose padding.
