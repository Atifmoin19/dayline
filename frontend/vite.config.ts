import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tsconfigPaths(),
    svgr({
      svgrOptions: {
        plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
        svgoConfig: {
          plugins: [
            "preset-default",
            "removeTitle",
            "removeDesc",
            "removeDoctype",
            "cleanupIds",
          ],
        },
      },
    }),
  ],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "src") }],
  },
  build: {
    // The single vendor chunk is ~800 kB (~265 kB gzip), mostly Chakra UI + Emotion.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // One vendor chunk for all of node_modules: it changes far less often than app code,
        // so browsers keep it cached across deploys. Finer splits (chakra / redux / react /
        // rest) formed circular chunk imports that left React undefined at startup in
        // production builds. Route-level lazy() loading keeps app code split per page.
        manualChunks(id) {
          return id.includes("node_modules") ? "vendor" : undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
