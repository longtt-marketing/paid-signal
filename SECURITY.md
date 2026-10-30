# Security

Please report a vulnerability through GitHub's private vulnerability reporting on this repository, not in a public issue.

The public demo runs in the PayPal sandbox. Keys live in Cloudflare Worker secrets, never in the repository. Payer emails are stored only as hashes; lead emails are used only to send their invoice and are not on any public API.
