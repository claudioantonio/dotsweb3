import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // NODE_PROXY_TARGET (no VITE_ prefix → never shipped to the browser) turns on a
  // dev-server proxy for nodes that send no CORS headers. Off unless set.
  const proxyTarget = loadEnv(mode, process.cwd(), "").NODE_PROXY_TARGET;
  return {
    plugins: [react()],
    server: proxyTarget
      ? { proxy: { "/rpc": proxyTarget, "/inspect": proxyTarget } }
      : undefined,
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
