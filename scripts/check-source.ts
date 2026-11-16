import { checkSocialBoundary, checkSonnerBoundary, checkSources } from "./source-guards";
const violations = checkSources();
const boundary = [...checkSocialBoundary(), ...checkSonnerBoundary()];
for (const { file, rule } of boundary) console.error(`${file}: boundary: ${rule}`);
if (boundary.length) process.exitCode = 1;
for (const { file, line, rule, text } of violations) console.error(`${file}:${line} ${rule}: ${text}`);
if (violations.length) process.exitCode = 1;
else if (!boundary.length) console.log("Source guards: no hard-coded JSX copy, feedback, or component colors.");
