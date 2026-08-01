# Agent Testbed

The Agent Testbed runs `data360` scenarios by launching the repository's compiled `bin/run.js` directly, captures redacted command and HTTP JSONL traces, validates every evidence reference, and compares results across agents or scripted personas on the same deterministic build hash. Salesforce CLI plugin discovery and installed-package behavior are covered separately by `yarn test:package` through a pinned real `sf` host.

Start with the prompt-ready protocol in [`AGENTS.md`](AGENTS.md). The public build, automation, and safety contract lives in [`../docs/CLI_CONTRACT.md`](../docs/CLI_CONTRACT.md).

## Local quick start

```shell
yarn build
node testbed/bin/testbed.mjs start --agent local-reviewer --model human --mode mock
node testbed/bin/testbed.mjs run --suite smoke
node testbed/bin/testbed.mjs run --suite query
node testbed/bin/testbed.mjs end
node testbed/bin/testbed.mjs report --since 7d --format both
```

Only one session can be current at a time. A normal `end` removes that pointer, and `start` automatically recovers a pointer to an already-ended session. If an agent process exits before `end`, resume that session or use `start --force` to mark it abandoned; `--force` refuses to replace a session with a fresh suite-run lock.

Sessions are mode `0700`, artifacts are mode `0600`, and `testbed/sessions/` is gitignored. Mock runtime homes live outside session artifacts and are deleted at session end. The validator rejects unexpected files. Reports are re-scrubbed and default to the ignored `internal/testbed/reports/` boundary. Use `--output-dir <path>` only for an approved restricted review or ephemeral CI artifact directory.

## Review a report in ten minutes

1. Confirm the session, scenario, assertion, and failure-cluster totals in **Summary**.
2. Scan **Outcome matrix** for failed or blocked scenarios and unexpected mode differences.
3. Review **Triangulated failures** first: two independent agents indicate a suspected CLI defect; a failure isolated to one agent while another passes indicates a likely usage or DX problem.
4. Follow each failure's session and evidence sequence numbers into `events.jsonl`; compare `command.exec`, client `http.*`, mock `http.*`, and `command.result` in order.
5. Check **Error codes** and the next command to see whether the advertised action recovered.
6. Compare p95 values with `yarn test:perf` as a review signal (the testbed measures full process duration, not the performance gate's exact cold-start/first-byte boundary), then inspect **Notes** and **Trend delta** for regressions, flakes, or newly resolved failures.

Never commit raw sessions or copy live tokens, usernames, org IDs, tenant URLs, or customer data into a note. `testbed validate` fails closed when it finds those patterns.
