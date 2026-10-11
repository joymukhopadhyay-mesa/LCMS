// npm run clear-demo -> delete only the September demo calls (external_id SEP26-*) and what hangs off them.
// Real calls from Vaani are untouched. Run this once Vaani is taking live calls.

import { closeDb, exec } from "../src/lib/db.ts";

const n = await exec("DELETE FROM calls WHERE external_id LIKE 'SEP26-%'");
console.log(`Removed ${n} demo call(s) from ${new URL(process.env.DATABASE_URL!).host}`);
await closeDb();
