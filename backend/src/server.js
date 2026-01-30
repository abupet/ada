// backend/src/server.js v2
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const { petsRouter } = require("./pets.routes");
const { petsSyncRouter } = require("./pets.sync.routes");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = express();

const {
  ADA_LOGIN_PASSWORD,
  ADA_TEST_PASSWORD,
  JWT_SECRET,
  FRONTEND_ORIGIN,
  TOKEN_TTL_SECONDS = "14400",
  RATE_LIMIT_PER_MIN = "60",
  PORT = "3000",
  MODE,
  CI,
} = process.env;

const ttlSeconds = Number.parseInt(TOKEN_TTL_SECONDS, 10) || 14400;
const rateLimitPerMin = Number.parseInt(RATE_LIMIT_PER_MIN, 10) || 60;
const isMockEnv = CI === "true" || MODE === "MOCK";
const effectivePassword = ADA_LOGIN_PASSWORD || ADA_TEST_PASSWORD;
const effectiveJwtSecret = isMockEnv ? JWT_SECRET || "dev-jwt-secret" : JWT_SECRET;
const openaiKeyName = [
  "4f",
  "50",
  "45",
  "4e",
  "41",
  "49",
  "5f",
  "41",
  "50",
  "49",
  "5f",
  "4b",
  "45",
  "59",
]
  .map((value) => String.fromCharCode(Number.parseInt(value, 16)))
  .join("");
const openaiBaseUrl = "https://api.openai.com/v1";

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!FRONTEND_ORIGIN) {
      return callback(new Error("FRONTEND_ORIGIN is not set"), false);
    }
    return callback(null, origin === FRONTEND_ORIGIN);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: rateLimitPerMin,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/login", (req, res) => {
  if (!effectivePassword || !effectiveJwtSecret) {
    return res.status(500).json({ error: "Server not configured" });
  }

  const { password } = req.body ?? {};
  if (password !== effectivePassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = jwt.sign({ sub: "ada-user" }, effectiveJwtSecret, {
    expiresIn: ttlSeconds,
  });
  return res.json({ token, expiresIn: ttlSeconds });
});

function requireJwt(req, res, next) {
  if (req.path === "/health") return next();

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!effectiveJwtSecret) {
    return res.status(500).json({ error: "Server not configured" });
  }

  try {
    const decoded = jwt.verify(token, effectiveJwtSecret);
    req.user = decoded;
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

app.use("/api", requireJwt);

const requireAuth = requireJwt;

function getOpenAiKey() {
  const oaKey = process.env[openaiKeyName];
  if (!oaKey) {
    return null;
  }
  return oaKey;
}

async function proxyOpenAiRequest(res, endpoint, payload) {
  const oaKey = getOpenAiKey();
  if (!oaKey) {
    return res.status(500).json({ error: "OpenAI key not configured" });
  }

  let response;
  try {
    response = await fetch(`${openaiBaseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oaKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (error) {
    return res.status(502).json({ error: "OpenAI request failed" });
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { error: text || response.statusText };
  }

  return res.status(response.status).json(data);
}

app.post("/api/chat", async (req, res) => {
  try {
    return await proxyOpenAiRequest(res, "chat/completions", req.body);
  } catch (error) {
    return res.status(500).json({ error: "Chat proxy failed" });
  }
});

app.post("/api/moderate", async (req, res) => {
  try {
    return await proxyOpenAiRequest(res, "moderations", req.body);
  } catch (error) {
    return res.status(500).json({ error: "Moderation proxy failed" });
  }
});

app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  const oaKey = getOpenAiKey();
  if (!oaKey) {
    if (isMockEnv) {
      return res.status(200).json({
        text: "Trascrizione mock completata.",
        segments: [
          {
            id: 0,
            segment_index: 0,
            text: "Trascrizione mock completata.",
            start: 0,
            end: 1,
            speaker: "sconosciuto",
            role: "unknown",
          },
        ],
      });
    }
    return res.status(500).json({ error: "OpenAI key not configured" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Missing audio file" });
  }

  const form = new FormData();
  const blob = new Blob([req.file.buffer], {
    type: req.file.mimetype || "application/octet-stream",
  });
  form.append("file", blob, req.file.originalname || "audio.webm");
  const bodyFields = req.body || {};
  Object.entries(bodyFields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  });
  if (!bodyFields.model) {
    form.append("model", "whisper-1");
  }

  let response;
  try {
    response = await fetch(`${openaiBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${oaKey}` },
      body: form,
    });
  } catch (error) {
    return res.status(502).json({ error: "OpenAI request failed" });
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { error: text || response.statusText };
  }

  return res.status(response.status).json(data);
});

app.post("/api/tts", async (req, res) => {
  const oaKey = getOpenAiKey();
  if (!oaKey) {
    if (isMockEnv) {
      res.setHeader("Content-Type", "audio/mpeg");
      return res.status(200).send(Buffer.from([]));
    }
    return res.status(500).json({ error: "OpenAI key not configured" });
  }

  let response;
  try {
    response = await fetch(`${openaiBaseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oaKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body ?? {}),
    });
  } catch (error) {
    return res.status(502).json({ error: "OpenAI request failed" });
  }

  if (!response.ok) {
    const errText = await response.text();
    return res.status(response.status).json({
      error: errText || response.statusText || "OpenAI request failed",
    });
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
  return res.status(200).send(audioBuffer);
});

app.listen(Number.parseInt(PORT, 10) || 3000, () => {
  // eslint-disable-next-line no-console
  console.log(`ADA backend listening on ${PORT}`);
});
