#!/usr/bin/env node
// Copies Hive's Supabase migrations into e2e/supabase/migrations, so the
// end-to-end suite runs against the same schema, policies and functions the
// real project has.
//
// KitchenHub lives in Hive's Supabase project, and Hive's repository
// (Fridge-Board) owns its migrations. This keeps a copy here so CI needs no
// access to that repository. Re-run it after Hive gains a migration:
//
//   node scripts/sync-hive-schema.mjs ../Fridge-Board
//
// Each copy gets one line on top, `set check_function_bodies = off;`. Hive's
// migrations are applied one by one to the hosted project, where an SQL
// function may name a table a later migration makes; on a fresh database that
// only works if the bodies are checked when the functions run, not when they
// are made. Nothing else is changed.

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const hive = resolve(process.argv[2] || '../Fridge-Board');
const from = join(hive, 'supabase', 'migrations');
const to = resolve('e2e', 'supabase', 'migrations');
const LOCAL = '20261119000000_local_stack.sql';

if (!existsSync(from)) {
  console.error(`No migrations at ${from}. Pass the path to Hive's checkout.`);
  process.exit(1);
}

for (const f of readdirSync(to)) if (f !== LOCAL && f.endsWith('.sql')) rmSync(join(to, f));

const files = readdirSync(from)
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const f of files) {
  const sql = readFileSync(join(from, f), 'utf8');
  writeFileSync(join(to, f), `set check_function_bodies = off;\n${sql}`);
}
console.log(`Copied ${files.length} migrations from ${from}`);
