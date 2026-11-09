# PS5 PRO CHAT local development

From PowerShell in this repository:

```powershell
.\scripts\setup-ps5-dev.ps1
docker compose --env-file .env.ps5-dev -f docker-compose.yml -f docker-compose.ps5-dev.yml config --quiet
docker compose --env-file .env.ps5-dev -f docker-compose.yml -f docker-compose.ps5-dev.yml up -d --build
```

Open the chat at http://localhost:3081 and the admin panel at http://localhost:3001.
The API image is built from this checkout. Compose uses the `ps5-pro-chat-dev` project,
which gives MongoDB, Meilisearch, PostgreSQL, and LibreChat data separate storage.
The setup script copies the local `.env` to an ignored `.env.ps5-dev` and creates fresh
development secrets. Run it once; it will not overwrite an existing development env file.
The copied provider credentials remain in `.env.ps5-dev` so the configured model can work.

## Supabase sign-in for the full LibreChat app

To use Supabase Auth for the branded LibreChat app on port 3081, add these settings
to the ignored `.env.ps5-dev` file:

```dotenv
SUPABASE_AUTH_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_AUTH_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_PASSWORD_RESET=true
ALLOW_EMAIL_CHANGE=false
```

In Supabase Authentication → URL Configuration, allow `http://localhost:3081/**`
as a redirect URL. Sign-up confirmation and password recovery links then return
to LibreChat on port 3081. Supabase verifies email addresses and passwords;
LibreChat keeps its full interface, tools, and conversations in this project's
separate MongoDB volume. The first confirmed account in an empty LibreChat
database becomes the administrator. Do not mix this volume with the existing LibreChat
deployment on port 3080.

To stop this development stack without deleting its data:

```powershell
docker compose --env-file .env.ps5-dev -f docker-compose.yml -f docker-compose.ps5-dev.yml down
```
