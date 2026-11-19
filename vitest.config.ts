import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const alias = { "@": root };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // Runs the real `terraform` binary (init/validate) against generated
        // configurations. Skipped automatically when terraform is not installed.
        resolve: { alias },
        test: {
          name: "terraform",
          environment: "node",
          include: ["tests/terraform/**/*.test.ts"],
          // terraform init installs providers into each temp workspace; separate
          // worker processes doing that at the same time race on the shared
          // plugin cache (observed on Windows). Run all files in one fork, one at a time.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
