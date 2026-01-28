const { spawnSync } = require("node:child_process");

const args = new Set(process.argv.slice(2));
const includeLong = args.has("--long");
const onlyLong = args.has("--long-only");
const skipPolicy = args.has("--skip-policy");

const steps = [];

if (!onlyLong && !skipPolicy) {
  steps.push({
    name: "Policy checks",
    command: "node",
    args: ["tests/policy/policy-checks.js"],
  });
}

if (!onlyLong) {
  steps.push({
    name: "Smoke tests",
    command: "npx",
    args: ["playwright", "test", "--grep", "@smoke"],
  });

  steps.push({
    name: "Regression tests",
    command: "npx",
    args: ["playwright", "test"],
  });
}

if (onlyLong || includeLong) {
  steps.push({
    name: "Long tests",
    command: "npx",
    args: ["playwright", "test", "--grep", "@long"],
  });
}

if (steps.length === 0) {
  console.error("No test steps selected. Use --long, --long-only, or remove --skip-policy.");
  process.exit(1);
}

for (const step of steps) {
  console.log(`\n▶ ${step.name}`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit" });

  if (result.error) {
    console.error(`Failed to run ${step.name}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
