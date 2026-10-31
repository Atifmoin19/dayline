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
    // No manualChunks. Hand-made vendor groups formed circular chunk imports that left
    // React undefined at startup in production (blank page), and a single catch-all vendor
    // chunk made every page, including the landing page, download app-only code. Rollup's
    // own splitting follows the lazy() routes and keeps execution order correct.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
