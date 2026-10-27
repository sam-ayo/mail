// Encrypts all stored secrets again with the current ENCRYPTION_KEY. The old
// keys must be in ENCRYPTION_KEY_PREVIOUS. See "Rotate the encryption key" in README.md.
//
// Usage: pnpm reencrypt          (changes the database)
//        pnpm reencrypt --check  (only counts the values that an old key encrypted)
// The script uses DATABASE_URL, ENCRYPTION_KEY, and ENCRYPTION_KEY_PREVIOUS from
// the environment or from .env.

// env.server.ts requires SESSION_SECRET, but this script makes no sessions. A
// placeholder means that you do not have to copy the real secret for the script.
process.env.SESSION_SECRET ||= "not used by the reencrypt script";
const { currentKeyPrefix, decrypt, encrypt } = await import("../app/server/crypto.server");
const { query } = await import("../app/server/db.server");
export {};

const tables = [
  { table: "accounts", column: "credentials", keys: ["id"] },
  { table: "thread_summaries", column: "summary", keys: ["account_id", "thread_id", "people"] },
];

const check = process.argv.includes("--check");
let failed = 0;
// The rows that failed, by error. A lost key fails each row with the same error.
const failures = new Map<string, string[]>();

for (const { table, column, keys } of tables) {
  // Do not use LIKE: the key ID can contain "_", which LIKE reads as a wildcard.
  const old = `left(${column}, ${currentKeyPrefix.length}) <> '${currentKeyPrefix}'`;
  if (check) {
    const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM ${table} WHERE ${old}`);
    console.log(`${table}.${column}: ${count} values use an old key`);
    if (Number(count) > 0) failed++;
    continue;
  }

  const keyList = keys.join(", ");
  const keyParams = keys.map((_, i) => `$${i + 1}`).join(", ");
  let after: unknown[] | undefined;
  let changed = 0;
  let skipped = 0;
  for (;;) {
    // Page by the primary key, so a row that fails does not come back.
    const rows = await query<Record<string, string>>(
      `SELECT ${keyList}, ${column} AS value FROM ${table}
       WHERE ${old} ${after ? `AND (${keyList}) > (${keyParams})` : ""}
       ORDER BY ${keyList} LIMIT 200`,
      after ?? [],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = keys.map((key) => row[key]);
      let value: string;
      try {
        value = encrypt(decrypt(row.value));
      } catch (error) {
        const message = `${table}: ${(error as Error).message}`;
        failures.set(message, [...(failures.get(message) ?? []), id.join("/")]);
        failed++;
        continue;
      }
      // The WHERE on the old value keeps a newer write of the app.
      const updated = await query(
        `UPDATE ${table} SET ${column} = $${keys.length + 1}
         WHERE (${keyList}) = (${keyParams}) AND ${column} = $${keys.length + 2} RETURNING 1`,
        [...id, value, row.value],
      );
      if (updated.length) changed++;
      else skipped++;
    }
    after = keys.map((key) => rows[rows.length - 1][key]);
  }
  console.log(`${table}.${column}: ${changed} encrypted again, ${skipped} changed by the app during the run`);
}

for (const [message, ids] of failures) {
  console.error(`${ids.length} values failed. ${message}`);
  console.error(`  First rows: ${ids.slice(0, 5).join(", ")}`);
}
if (failed) {
  console.error(check ? "Old keys are still in use. Do not remove them." : `${failed} values failed. Do not remove the old keys.`);
  process.exit(1);
}
console.log(check ? "All values use the current key." : "Done. Run `pnpm reencrypt --check` to confirm.");
