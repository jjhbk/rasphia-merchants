# Local development database

Rasphia uses PostgreSQL-specific schema features, so local testing runs against a local PostgreSQL container rather than SQLite.

1. In Docker Desktop, enable **Settings → Resources → WSL Integration** for this Linux distribution.
2. Start the database:

   ```bash
   docker compose up -d postgres
   ```

3. Copy the `DATABASE_URL` from `.env.local.postgres.example` into `.env.local`, replacing the hosted Neon value for local testing only.
4. Apply the schema:

   ```bash
   pnpm migrate
   ```

5. Start the app:

   ```bash
   pnpm dev
   ```

To return to Neon, restore the hosted `DATABASE_URL` in `.env.local`. The Docker volume is named `rasphia_postgres_data`; it is retained across container restarts.
