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

To stop this development stack without deleting its data:

```powershell
docker compose --env-file .env.ps5-dev -f docker-compose.yml -f docker-compose.ps5-dev.yml down
```
