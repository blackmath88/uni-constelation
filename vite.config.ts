import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// The app reads the committed JSON snapshot in data/. Only these files are
// served/copied — data/raw/ stays out of the static bundle.
const DATA_FILES = ["graph.json", "layout.json", "coverage.json", "publications.json", "publication-details.json", "researchers.json"];

function committedData(): Plugin {
  return {
    name: "committed-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/data\/([\w.-]+\.json)(\?.*)?$/);
        if (!m || !DATA_FILES.includes(m[1])) return next();
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(resolve(__dirname, "data", m[1])));
      });
    },
    generateBundle() {
      for (const f of DATA_FILES) {
        const p = resolve(__dirname, "data", f);
        if (!existsSync(p)) this.error(`missing data/${f} — run npm run graph`);
        this.emitFile({ type: "asset", fileName: `data/${f}`, source: readFileSync(p) });
      }
    },
  };
}

// Production build and preview use the GitHub repository subpath; dev serves from "/".
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/uni-constelation/" : "/",
  plugins: [react(), committedData()],
  build: { target: "es2020", chunkSizeWarningLimit: 900 },
  preview: { port: 4173 },
}));
