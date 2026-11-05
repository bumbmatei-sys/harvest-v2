import { checkSources } from "./source-guards";
const violations = checkSources();
for (const { file, line, rule, text } of violations) console.error(`${file}:${line} ${rule}: ${text}`);
if (violations.length) process.exitCode = 1;
else console.log("Source guards: no hard-coded JSX copy, feedback, or component colors.");
