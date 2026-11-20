import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/lumen_test";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "test-only-secret",
      FRONTEND_URL: "http://localhost:3000",
    },
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
