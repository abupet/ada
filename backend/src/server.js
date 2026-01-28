const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");

const app = express();

const {
  ADA_LOGIN_PASSWORD,
  JWT_SECRET,
  FRONTEND_ORIGIN,
  OPENAI_API_KEY,
  TOKEN_TTL_SECONDS = "14400",
  RATE_LIMIT_PER_MIN = "60",
  PORT = "3000",
} = process.env;

const ttlSeconds = Number.parseInt(TOKEN_TTL_SECONDS, 10) || 14400;
const rateLimitPerMin = Number.parseInt(RATE_LIMIT_PER_MIN, 10) || 60;

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
  if (!ADA_LOGIN_PASSWORD || !JWT_SECRET) {
    return res.status(500).json({ error: "Server not configured" });
  }

  const { password } = req.body ?? {};
  if (password !== ADA_LOGIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = jwt.sign({ sub: "ada-user" }, JWT_SECRET, { expiresIn: ttlSeconds });
  return res.json({ token, expiresIn: ttlSeconds });
});

function requireJwt(req, res, next) {
  if (req.path === "/api/health") return next();

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({ error: "Server not configured" });
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

app.use("/api", requireJwt);

async function proxyOpenAI(req, res, endpoint) {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
  }

  try {
    const apiResponse = await fetch(`https://api.openai.com${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const contentType = apiResponse.headers.get("content-type") || "application/json";
    const payload = await apiResponse.text();
    return res.status(apiResponse.status).type(contentType).send(payload);
  } catch (error) {
    return res.status(500).json({ error: "OpenAI request failed" });
  }
}

app.post("/api/chat", (req, res) => proxyOpenAI(req, res, "/v1/chat/completions"));
app.post("/api/moderate", (req, res) => proxyOpenAI(req, res, "/v1/moderations"));

app.listen(Number.parseInt(PORT, 10) || 3000, () => {
  // eslint-disable-next-line no-console
  console.log(`ADA backend listening on ${PORT}`);
});
