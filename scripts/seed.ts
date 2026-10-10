// npm run seed -> wipe the database and load the September demo calls.
// The data and the engine-vs-calibration check live in src/lib/demo-seed.ts.

import { seedDemo } from "../src/lib/demo-seed.ts";
import { db } from "../src/lib/db.ts";

const report = seedDemo();
const { n } = db().prepare("SELECT COUNT(*) AS n FROM calls").get() as { n: number };
console.log(`Seeded ${n} calls into ${process.env.DATABASE_PATH || "./data/lcms.db"}\n`);
console.log("Scoring engine vs. calibration table:");
console.log(report.join("\n"));
