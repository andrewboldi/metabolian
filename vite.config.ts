import { defineConfig } from "vite";
import { resolve } from "node:path";

// Project pages served from web/. Multi-page app so each route ships only its
// own JS — heavy libs (cytoscape, three, 3dmol) are dynamically imported per page.
const page = (name: string) => resolve(__dirname, "web", name);

export default defineConfig({
  root: "web",
  base: process.env.METABOLIAN_BASE ?? "/metabolian/",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    cssMinify: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        home: page("index.html"),
        explore: page("explore.html"),
        pathway: page("pathway.html"),
        protein: page("protein.html"),
        glossary: page("glossary.html"),
        learn: page("learn.html"),
        about: page("about.html"),
        login: page("login.html"),
      },
    },
  },
  server: { port: 5173, open: false },
});
