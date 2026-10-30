# Contributing

Paid Signal is a hackathon entry, but issues and pull requests are welcome.

- `npm test` runs the money rules, the evidence gate, the four agents (with scripted models), schema checks, MCP and the AG Studio tool names. It needs no keys.
- `node scripts/e2e.mjs` checks the live demo in a browser; the `scripts/eval-*.mjs` scripts reproduce every number on /proof and need an Anthropic key in `.dev.vars`.
- Money is handled in cents. Anything an agent does that sends or spends goes through a code check and a person's approval; keep it that way.
- Never commit keys, tokens, payer emails or real customer data. The demo shop and its leads are fictional.
