import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

function standaloneFilename() {
  return {
    name: "standalone-filename",
    closeBundle() {
      const index = resolve("html-dist/index.html");
      const standalone = resolve("html-dist/standalone.html");
      if (existsSync(index)) renameSync(index, standalone);

      const html = readFileSync(standalone, "utf8");
      const hasInlineScript = /<script(?:\s[^>]*)?>[\s\S]+<\/script>/i.test(html);
      const hasInlineStyle = /<style(?:\s[^>]*)?>[\s\S]+<\/style>/i.test(html);
      const hasExternalScript = /<script[^>]+\bsrc\s*=/i.test(html);
      const hasExternalStylesheet = /<link[^>]+\brel\s*=\s*["']stylesheet["']/i.test(html);
      if (!hasInlineScript || !hasInlineStyle || hasExternalScript || hasExternalStylesheet) {
        throw new Error("Standalone HTML must contain inline JavaScript and CSS only");
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: standalone ? [viteSingleFile(), standaloneFilename()] : [],
    server: { proxy: { "/api/ban-appeals": "http://localhost:3000", "/api/maintenance": "http://localhost:3000",
      "/maintenance.html": "http://localhost:3000", "/maintenance-range.js": "http://localhost:3000" } },
    build: standalone ? { outDir: "html-dist" } : {}
  };
});
