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
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
