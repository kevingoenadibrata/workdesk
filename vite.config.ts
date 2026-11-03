import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // The app, the onboarding tour that opens in its own window over the display,
  // the strip around the MacBook notch, the panel beside the Dock, and the phone
  // mirror's web app (served to your phone by src-tauri/src/phone.rs).
  build: {
    rolldownOptions: {
      input: { main: "index.html", onboarding: "onboarding.html", notch: "notch.html", dock: "dock.html", phone: "phone.html" },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
