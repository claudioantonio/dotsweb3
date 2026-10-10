import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** ux-plan §5: dark-first custom system. The app sets `class="dark"` on <html>. */
const config = defineConfig({
  globalCss: {
    "html, body": {
      bg: "surface.base",
      color: "fg",
      fontFamily: "body",
    },
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
        heading: { value: "'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
        mono: { value: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
      },
      colors: {
        accent: { value: "#15aabf" },
        success: { value: "#40c057" },
        warning: { value: "#fab005" },
        danger: { value: "#fa5252" },
        playerA: { value: "#38B2AC" },
        playerB: { value: "#ED8936" },
      },
    },
    semanticTokens: {
      colors: {
        surface: {
          base: { value: "#141517" },
          raised: { value: "#1a1b1e" },
          overlay: { value: "#25262b" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

/** Board colours by seat (players[0] / players[1]); SVG needs raw values. */
export const SEAT_COLORS = ["#38B2AC", "#ED8936"] as const;
