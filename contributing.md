# Development

Use Node.js 22.13 or later and npm. Follow the setup and verification commands in `readme.md`.

The application lives in `apps/web` and `apps/server`. Keep server-side validation and room membership checks for every new event. Never trust a display name or socket-supplied target as authorization. Add integration tests for changed room, messaging, or signaling behavior.

Commit no credentials, database files, or generated build output. Use `.env.example` to document new configuration without actual secrets.
