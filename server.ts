import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Link Preview Scraper
  app.get("/api/link-preview", async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Referer": "https://www.google.com/"
        },
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        throw new Error("Access forbidden (403)");
      }

      const $ = cheerio.load(response.data);
      const title = $('meta[property="og:title"]').attr("content") || $("title").text();
      const description = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");
      const image = $('meta[property="og:image"]').attr("content");

      const finalTitle = (title ? title.trim() : new URL(url).hostname).slice(0, 100);
      const finalDesc = (description ? description.trim() : "").slice(0, 200);

      res.json({
        title: finalTitle,
        description: finalDesc,
        image: image || "",
        status: response.status,
        url,
      });
    } catch (error: any) {
      // Fallback for failed previews
      let hostname = "External Link";
      try { hostname = new URL(url).hostname; } catch (e) {}

      res.json({
        title: hostname.length > 25 ? hostname.slice(0, 22) + '...' : hostname,
        description: "Access Restricted: Security protection active for this host. Click to visit source directly.",
        image: "",
        status: error.response?.status || 500,
        url,
        isRestricted: true
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
