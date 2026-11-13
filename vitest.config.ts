import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// Route handlers import through the app's "@/" alias.
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
export default defineConfig({
  test: { projects: [
    { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
    { resolve: { alias }, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } }
    ,{ test: { name: "neon", include: ["tests/neon/**/*.test.ts"], environment: "node", fileParallelism: false, testTimeout: 60000 } }
  ] }
});
