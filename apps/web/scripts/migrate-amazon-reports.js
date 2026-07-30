"use strict";

const { migrateAmazonReports } = require("../lib/amazon-report-migration");

function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const confirm = argv.includes("--confirm");
  const rootArg = argv.find((item) => item.startsWith("--users-root="));
  const usersRoot = rootArg ? rootArg.slice("--users-root=".length) : "D:\\KIMI\\work-users";
  const summary = migrateAmazonReports({ usersRoot, apply, confirm });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
