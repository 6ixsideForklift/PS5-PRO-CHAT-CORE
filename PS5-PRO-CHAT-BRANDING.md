# PS5 PRO CHAT branding workstream

This is a maintained fork of LibreChat. Retain upstream copyright, license notices, and internal package identifiers needed for compatibility.

## Implemented on this branch
- Browser document title: PS5 PRO CHAT.
- HTML description: PS5 PRO CHAT.
- Selected English UI messages that referred to the product as LibreChat now say PS5 PRO CHAT.

## Still required
- Replace actual login/signup and navigation logos and favicon assets (source asset paths and trademark requirements must be reviewed).
- Find and replace runtime product name where safe without renaming API routes, environment variables, internal package names, config file names, or breaking upstream integrations.
- Review other languages/translations, accessibility labels, and email templates.
- Build and run fork in separate development deployment; the working E:\LibreChat install must remain untouched.
- Verify login, chat, PS5 custom endpoint, SSE reasoning, agents, uploads and account flows.
- Document fork modifications and preserve original MIT license/attribution.

## Deployment caution
Editing the GitHub fork does NOT change the existing Docker image registry.librechat.ai/librechat-ai/librechat-dev:latest. A separate source build and deployment is needed to see branding changes. Do not repoint the current production/reference Compose stack until tests pass.
