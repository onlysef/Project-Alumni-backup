import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
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
