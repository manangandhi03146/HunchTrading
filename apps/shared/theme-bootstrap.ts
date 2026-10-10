import type { Plugin } from "vite";
import { initialTheme, THEME_STORAGE_KEY } from "./theme-preference";

/** One early initializer for all three app entry points, in dev and builds. */
export function themeBootstrap(): Plugin {
  return {
    name: "hunch-theme-bootstrap",
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "script",
          children: `(()=>{const theme=(${initialTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;})()`,
          injectTo: "head-prepend",
        },
      ],
    },
  };
}
