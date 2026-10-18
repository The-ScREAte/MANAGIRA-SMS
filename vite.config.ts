import { defineConfig } from "vite";
import ejs from "ejs";
import { readFile } from "node:fs/promises";

export default defineConfig({
  plugins: [{
    name: "mira-public-preview",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] === "/static/index.html") {
          try {
            const source = await readFile("public/static/index.html", "utf8");
            const footer = await ejs.renderFile("views/partials/footer.ejs", { session: {}, showFooterTopSection: true });
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(source.replace(/<footer class="managira-footer">[\s\S]*?<\/footer>\s*<style>[\s\S]*?<\/style>/, footer));
          } catch (error) {
            next(error);
          }
          return;
        }
        if (req.url?.split("?")[0] !== "/legal/mira-ai-assistant") return next();
        try {
          const source = await readFile("views/legal&Compliance/MiraAiAssistant.ejs", "utf8");
          const content = ejs.render(source, { session: {} });
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mira AI Assistant | Managira</title><meta name="description" content="Meet Mira, Managira's school assistant for attendance, fees, enrollment and reports."><meta property="og:title" content="Mira AI Assistant | Managira"><meta property="og:description" content="Mira helps schools with attendance, fees, enrollment and reports."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"></head><body>${content}</body></html>`);
        } catch (error) {
          next(error);
        }
      });
    },
  }],
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    outDir: "dist",
  },
  publicDir: "public",
});
