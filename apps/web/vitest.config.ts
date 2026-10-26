import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    alias: {
      // `server-only` throws on import outside a Server Component. The guard is
      // worth keeping in the build, so it is stubbed here rather than removed
      // from the modules it protects.
      "server-only": new URL("./test/stubs/server-only.ts", import.meta.url).pathname,
      // The app's own `@/` imports, so a route handler can be run as written.
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
});
