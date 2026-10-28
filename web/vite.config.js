import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Worker serves ../public; the app builds into it next to shop.html and the demo data.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: false, assetsDir: "assets", chunkSizeWarningLimit: 6000 },
  server: { proxy: { "/api": "https://paid-signal.thelongmarketing.workers.dev" } },
});
