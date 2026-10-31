/// <reference types="vitest/config" />
import { defineConfig } from "vite";
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
    rollupOptions: {
      output: {
        // Route-level lazy() splitting (see AppRouter.tsx) got the main chunk down from
        // ~984KB to ~810KB, but it's still over Vite's 500KB warning threshold — the bulk
        // of what's left is third-party vendor code that nearly every route depends on
        // (Chakra UI + Emotion + the framer-motion animations Chakra pulls in, Redux/RTK
        // Query, React Router) rather than app code that route-splitting can move. Grouping
        // those into their own vendor chunks gets each piece under the threshold and lets
        // browsers cache them separately from app code that changes far more often.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("@chakra-ui") ||
            id.includes("@emotion") ||
            id.includes("framer-motion")
          ) {
            return "vendor-chakra";
          }
          if (
            id.includes("react-redux") ||
            id.includes("@reduxjs") ||
            id.includes("redux-persist")
          ) {
            return "vendor-redux";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("react-router")
          ) {
            return "vendor-react";
          }
          return "vendor";
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
