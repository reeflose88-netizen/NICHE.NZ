import express from "express";
import { linkPreview } from "./utils/link-preview";

const app = express();

// Enable CORS for client-side requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

app.get("/api/link-preview", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL parameter is required" });
    }
    const preview = await linkPreview(url);
    res.json(preview);
  } catch (error) {
    console.error("Link preview error:", error);
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});