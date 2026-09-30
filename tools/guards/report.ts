import { readBaselines } from "./baseline.js";
import { RULES } from "./rules.js";

const baselines = readBaselines();
const sizes = RULES.flatMap((rule) => {
  const total = Object.values(baselines[rule.id] ?? {}).reduce((sum, n) => sum + n, 0);
  return total > 0 ? [`${rule.id} ${rule.name}: ${total}`] : [];
});
console.log(`${RULES.length} guards pass. Known violations, which may only shrink:\n  ${sizes.join("\n  ") || "none"}`);
