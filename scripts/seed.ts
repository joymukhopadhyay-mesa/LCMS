// npm run seed -> wipe the database and load the September demo calls.
// The data and the engine-vs-calibration check live in src/lib/demo-seed.ts.
//
// This TRUNCATES every table. It refuses to run if the database holds anything that is
// not demo data (real calls from Vaani) unless you pass --force.

import { seedDemo } from "../src/lib/demo-seed.ts";
import { closeDb, query } from "../src/lib/db.ts";

const [{ real }] = await query<{ real: number }>("SELECT COUNT(*)::int AS real FROM calls WHERE external_id NOT LIKE 'SEP26-%'");
if (real > 0 && !process.argv.includes("--force")) {
  console.error(`Refusing to seed: this database has ${real} real call(s). Pass --force to wipe them anyway.`);
  await closeDb();
  process.exit(1);
}

const report = await seedDemo();
const [{ n }] = await query<{ n: number }>("SELECT COUNT(*)::int AS n FROM calls");
const host = new URL(process.env.DATABASE_URL!).host;
console.log(`Seeded ${n} calls into ${host}\n`);
console.log("Scoring engine vs. calibration table:");
console.log(report.join("\n"));
await closeDb();
