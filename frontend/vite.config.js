import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite 5.4+ rejects any request whose Host header isn't localhost/an
    // explicitly allowed host (DNS-rebinding protection) — without this, a
    // request arriving through a forwarded VS Code dev tunnel gets a flat
    // 403 "Blocked request" for EVERY route, including /api, since the
    // tunnel preserves the original public hostname in the Host header
    // instead of rewriting it to localhost.
    allowedHosts: ['.devtunnels.ms'],
    // Lets a tunneled/forwarded frontend (e.g. VS Code dev tunnels) reach
    // the backend through this SAME origin instead of needing its own
    // separate public tunnel — see public/config.js for why a second
    // tunnel origin breaks devtunnels.ms's click-through auth for
    // background fetch() calls.
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
