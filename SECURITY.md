# Security

Night Shift reads your Claude Code logs, which can contain private code, file paths and commands. So it is built to
keep them on your computer: it only reads those files, listens on localhost only, makes no outgoing network calls and
has no telemetry. A test fails if any of that changes.

Found a way it could leak or change your data? Please email denis@zontakllc.com instead of opening a public issue.
You will get an answer within a few days.
