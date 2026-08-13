import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required to run database migrations."); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql`create table if not exists schema_migrations (id varchar(255) primary key, applied_at timestamptz not null default now())`;
  const files = (await readdir(resolve("db/migrations"))).filter((file) => file.endsWith(".sql")).sort();
  const applied = new Set((await sql`select id from schema_migrations`).map((item) => item.id));
  for (const file of files) {
    if (applied.has(file)) continue;
    const migration = await readFile(resolve("db/migrations", file), "utf8");
    await sql.begin(async (transaction) => { await transaction.unsafe(migration); await transaction`insert into schema_migrations (id) values (${file})`; });
    console.log(`Applied ${file}`);
  }
  console.log("Database migrations are up to date.");
} finally { await sql.end(); }
