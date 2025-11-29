import { defineConfig } from "vite";
import { builtinModules } from "module";
import commonjs from "@rollup/plugin-commonjs";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    commonjs({
      ignoreDynamicRequires: true,
      defaultIsModuleExports: true,
    }),
  ],
  build: {
    commonjsOptions: {
      ignoreDynamicRequires: true,
      defaultIsModuleExports: true,
    },
    rollupOptions: {
      external: [
        // Node.js built-in modules
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        // Native/complex Node modules that shouldn't be bundled
        "@google-cloud/speech",
        "@google-cloud/text-to-speech",
        "electron",
        "node-record-lpcm16",
        "dotenv",
        "electron-squirrel-startup",
        "sharp",
        "screenshot-desktop",
        // AI SDK packages (server-side, have complex dependencies)
        "@ai-sdk/anthropic",
        "@ai-sdk/gateway",
        "@ai-sdk/provider",
        "@ai-sdk/provider-utils",
        "@vercel/oidc",
        "@google/generative-ai",
        "@google/genai",
        "ai",
        "ws",
        "@computer-use/nut-js",
        "electron-squirrel-startup",
      ],
    },
  },
});
