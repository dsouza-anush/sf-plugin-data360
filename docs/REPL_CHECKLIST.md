# Query REPL operator checklist

Use a non-production Data 360 org. Parser, formatting, history, file-output, and signal behavior are covered by automated tests; this checklist validates the terminal integration without multiplying live query credits.

## Approval and preparation

1. Obtain explicit approval for one Query SQL submission and confirm the org's credit budget.
2. Set `D360_LIVE_BILLABLE=1` as an operator acknowledgement. The REPL doesn't read this variable; the gate documents that approval was granted.
3. Create `/tmp/data360-repl.sql` containing one org-valid, bounded query with `LIMIT 1`. Do not use joins, cross joins, aggregates over an unbounded table, or customer-sensitive projected fields.
4. Record the org alias, plugin commit, operator, approval, and start time. Never record result rows, tokens, auth URLs, org domains, or customer identifiers.

## Non-query terminal checks

1. Run `sf data360 query --target-org <test-org>` from a real TTY and confirm the `data360[default]>` prompt.
2. Enter an unfinished two-line query without `;` and confirm nothing executes. Press Ctrl-C and confirm only the buffer clears.
3. Toggle `\f csv`, `\x`, `\o /tmp/data360-repl.csv`, `\timing`, and `\dataspace <known-space>`; confirm the prompt and status messages change without submitting SQL.
4. Run `\dt dmo` and `\d <known-dmo>` and confirm metadata is displayed.
5. Press Ctrl-C twice with an empty buffer and confirm exit code 130.
6. Restart the REPL, confirm readline history is available, and run `\q`; confirm exit code 0.

## One approved live-query check

1. Restart the REPL with `--no-prompt` after recording credit approval, then set `\f csv`, `\o /tmp/data360-repl.csv`, and `\timing`. The startup flag is the one approved acknowledgement for this query-enabled session and avoids nesting a confirmation UI inside the REPL readline loop.
2. Run `\i /tmp/data360-repl.sql` exactly once. Confirm the bounded result is written to the file and timing is written to stderr; don't copy the result into test evidence.
3. Run `\last` and confirm it prints the latest query ID without exposing a token. Then run `\o` to restore stdout and `\q` to exit.
4. Delete `/tmp/data360-repl.sql` and `/tmp/data360-repl.csv`. Record pass/fail by checklist item, the query's bounded shape, and the single submission count—never its rows.

JSON and expanded-row rendering are deliberately left to the automated formatter/session tests so this manual check consumes at most one approved query submission.
