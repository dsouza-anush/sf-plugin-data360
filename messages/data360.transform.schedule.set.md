# summary

Set a data transform schedule.

# description

Set the execution schedule for a transform by using a cron expression.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --cron "0 0 * * *"
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --cron "0 0 * * *" --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.cron.summary

Cron expression for the transform schedule.

# flags.interval.summary

Named interval for the transform schedule.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.

# runtime.confirmSchedule

Replace the schedule for transform %s?
