/* Перед тестами: чистая схема в тестовой БД и применение всех миграций (тот же SQL, что в production). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/masterio_test';
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  const dir = join(__dirname, '..', 'prisma', 'migrations');
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of migrations) {
    await client.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
  }
  await client.end();
}
