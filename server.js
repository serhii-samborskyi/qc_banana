import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const GENERATED_DIR = path.join(DATA_DIR, "generated");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const ALLOWED_COLORS = ["orange", "black"];
const VALID_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const VALID_IMAGE_SIZES = ["512", "1K", "2K", "4K"];

const DEFAULT_PROMPT = `Create a realistic close-up field photo for cable QC.

Subject:
- A cable tap installed either on an aerial pole strand or at an underground pedestal / in bushes.
- Show the tap hardware clearly, with weathered gray metal or plastic housing, connectors, coax fittings, brackets, screws, nearby cable lines, and real outdoor surroundings.
- Connect one visible drop cable to the tap. The drop cable color must be {{cableColor}}.
- Add a small durable cable tag near the drop cable, similar to field QC examples. The tag must clearly show address number {{addressNumber}} in handwritten black marker.

Style:
- Photorealistic phone camera image, close framing, shallow natural depth of field, real utility-work texture.
- Do not make it a diagram, rendering, cartoon, or clean product photo.
- Do not add any text except the address number on the cable tag.`;

const defaultSettings = {
  googleApiKey: "",
  defaultModel: "gemini-3.1-flash-image",
  defaultAspectRatio: "3:4",
  defaultImageSize: "1K"
};

const defaultTasks = [
  {
    id: "tap-qc-default",
    name: "Cable Tap QC Photo",
    description: "Tap on pole strand or underground/bush pedestal with one orange or black connected cable.",
    prompt: DEFAULT_PROMPT,
    allowedColors: ["orange", "black"],
    model: "",
    aspectRatio: "3:4",
    imageSize: "1K",
    examples: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

await ensureStorage();

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1h" }));
app.use("/generated", express.static(GENERATED_DIR, { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = extensionFromMime(file.mimetype) || path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 14
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      cb(new Error("Only image files are allowed."));
      return;
    }
    cb(null, true);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR });
});

app.get("/api/bootstrap", async (_req, res, next) => {
  try {
    const [tasks, history, settings] = await Promise.all([getTasks(), getHistory(), getSettings()]);
    res.json({
      tasks: tasks.map(publicTask),
      history: history.map(publicGeneration),
      settings: publicSettings(settings)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", async (_req, res, next) => {
  try {
    res.json(publicSettings(await getSettings()));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    const current = await getSettings();
    const incoming = req.body || {};
    const nextSettings = {
      ...current,
      defaultModel: cleanString(incoming.defaultModel) || current.defaultModel || defaultSettings.defaultModel,
      defaultAspectRatio: normalizeAspectRatio(incoming.defaultAspectRatio, current.defaultAspectRatio),
      defaultImageSize: normalizeImageSize(incoming.defaultImageSize, current.defaultImageSize)
    };

    if (incoming.clearGoogleApiKey === true) {
      nextSettings.googleApiKey = "";
    } else if (typeof incoming.googleApiKey === "string" && incoming.googleApiKey.trim()) {
      nextSettings.googleApiKey = incoming.googleApiKey.trim();
    }

    await writeJson(SETTINGS_FILE, nextSettings);
    res.json(publicSettings(nextSettings));
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", async (_req, res, next) => {
  try {
    res.json((await getTasks()).map(publicTask));
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", upload.array("examples", 14), async (req, res, next) => {
  try {
    const tasks = await getTasks();
    const now = new Date().toISOString();
    const task = normalizeTaskInput(req.body, {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      examples: filesToExamples(req.files)
    });

    tasks.unshift(task);
    await writeJson(TASKS_FILE, tasks);
    res.status(201).json(publicTask(task));
  } catch (error) {
    await removeUploadedFiles(req.files);
    next(error);
  }
});

app.put("/api/tasks/:id", upload.array("examples", 14), async (req, res, next) => {
  try {
    const tasks = await getTasks();
    const index = tasks.findIndex((task) => task.id === req.params.id);
    if (index === -1) {
      await removeUploadedFiles(req.files);
      return res.status(404).json({ error: "Task not found." });
    }

    const existing = tasks[index];
    const task = normalizeTaskInput(req.body, {
      ...existing,
      updatedAt: new Date().toISOString(),
      examples: [...(existing.examples || []), ...filesToExamples(req.files)]
    });

    tasks[index] = task;
    await writeJson(TASKS_FILE, tasks);
    res.json(publicTask(task));
  } catch (error) {
    await removeUploadedFiles(req.files);
    next(error);
  }
});

app.delete("/api/tasks/:id", async (req, res, next) => {
  try {
    const tasks = await getTasks();
    const task = tasks.find((item) => item.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    await Promise.all((task.examples || []).map((example) => safeUnlink(path.join(UPLOAD_DIR, example.filename))));
    await writeJson(TASKS_FILE, tasks.filter((item) => item.id !== task.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:taskId/examples/:exampleId", async (req, res, next) => {
  try {
    const tasks = await getTasks();
    const task = tasks.find((item) => item.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    const example = (task.examples || []).find((item) => item.id === req.params.exampleId);
    if (!example) {
      return res.status(404).json({ error: "Example image not found." });
    }

    task.examples = task.examples.filter((item) => item.id !== example.id);
    task.updatedAt = new Date().toISOString();
    await safeUnlink(path.join(UPLOAD_DIR, example.filename));
    await writeJson(TASKS_FILE, tasks);
    res.json(publicTask(task));
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (_req, res, next) => {
  try {
    res.json((await getHistory()).map(publicGeneration));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/history/:id", async (req, res, next) => {
  try {
    const history = await getHistory();
    const generation = history.find((item) => item.id === req.params.id);
    if (!generation) {
      return res.status(404).json({ error: "Generation not found." });
    }

    await safeUnlink(path.join(GENERATED_DIR, generation.filename));
    await writeJson(HISTORY_FILE, history.filter((item) => item.id !== generation.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", async (req, res, next) => {
  try {
    const { taskId, addressNumber, cableColor } = req.body || {};
    const cleanAddress = normalizeAddressNumber(addressNumber);
    const cleanColor = normalizeColor(cableColor);

    if (!cleanAddress) {
      return res.status(400).json({ error: "Enter a numeric address number." });
    }
    if (!cleanColor) {
      return res.status(400).json({ error: "Choose orange or black cable." });
    }

    const [tasks, settings] = await Promise.all([getTasks(), getSettings()]);
    const task = tasks.find((item) => item.id === taskId) || tasks[0];
    if (!task) {
      return res.status(404).json({ error: "No task is configured yet." });
    }
    if (!task.allowedColors?.includes(cleanColor)) {
      return res.status(400).json({ error: `This task does not allow ${cleanColor} cable.` });
    }

    const apiKey = getGoogleApiKey(settings);
    if (!apiKey) {
      return res.status(409).json({ error: "Add a Google AI API key in Settings before generating images." });
    }

    const model = cleanString(task.model) || settings.defaultModel || defaultSettings.defaultModel;
    const aspectRatio = normalizeAspectRatio(task.aspectRatio, settings.defaultAspectRatio);
    const imageSize = normalizeImageSize(task.imageSize, settings.defaultImageSize);
    const prompt = buildPrompt(task.prompt, {
      taskName: task.name,
      addressNumber: cleanAddress,
      cableColor: cleanColor
    });

    const input = [{ type: "text", text: prompt }];
    for (const example of (task.examples || []).slice(0, 14)) {
      const absolutePath = path.join(UPLOAD_DIR, example.filename);
      const image = await readImageInput(absolutePath, example.mimeType);
      if (image) {
        input.push(image);
      }
    }

    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      input,
      store: false,
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: aspectRatio,
        image_size: imageSize
      }
    });

    const outputImage = interaction.output_image || interaction.outputImage;
    if (!outputImage?.data) {
      throw new Error(interaction.output_text || "Gemini did not return an image.");
    }

    const mimeType = outputImage.mime_type || "image/jpeg";
    const filename = `${Date.now()}-${crypto.randomUUID()}${extensionFromMime(mimeType) || ".jpg"}`;
    await fsp.writeFile(path.join(GENERATED_DIR, filename), Buffer.from(outputImage.data, "base64"));

    const generation = {
      id: crypto.randomUUID(),
      taskId: task.id,
      taskName: task.name,
      addressNumber: cleanAddress,
      cableColor: cleanColor,
      model,
      aspectRatio,
      imageSize,
      filename,
      mimeType,
      prompt,
      interactionId: interaction.id || "",
      createdAt: new Date().toISOString()
    };

    const history = await getHistory();
    history.unshift(generation);
    await writeJson(HISTORY_FILE, history);

    res.status(201).json(publicGeneration(generation));
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
    return;
  }
  next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || error.statusCode || 500;
  const message = status >= 500 ? sanitizeProviderError(error) : error.message;
  res.status(status).json({ error: message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`QC Banana listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

async function ensureStorage() {
  await Promise.all([fsp.mkdir(DATA_DIR, { recursive: true }), fsp.mkdir(UPLOAD_DIR, { recursive: true }), fsp.mkdir(GENERATED_DIR, { recursive: true })]);

  if (!fs.existsSync(SETTINGS_FILE)) {
    await writeJson(SETTINGS_FILE, defaultSettings);
  }
  if (!fs.existsSync(TASKS_FILE)) {
    await writeJson(TASKS_FILE, defaultTasks);
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    await writeJson(HISTORY_FILE, []);
  }
}

async function getSettings() {
  return { ...defaultSettings, ...(await readJson(SETTINGS_FILE, defaultSettings)) };
}

async function getTasks() {
  const tasks = await readJson(TASKS_FILE, defaultTasks);
  return Array.isArray(tasks) ? tasks : defaultTasks;
}

async function getHistory() {
  const history = await readJson(HISTORY_FILE, []);
  return Array.isArray(history) ? history : [];
}

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(file, data) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fsp.rename(temp, file);
}

function publicSettings(settings) {
  return {
    hasGoogleApiKey: Boolean(getGoogleApiKey(settings)),
    defaultModel: settings.defaultModel || defaultSettings.defaultModel,
    defaultAspectRatio: settings.defaultAspectRatio || defaultSettings.defaultAspectRatio,
    defaultImageSize: settings.defaultImageSize || defaultSettings.defaultImageSize,
    dataDir: DATA_DIR
  };
}

function publicTask(task) {
  return {
    ...task,
    examples: (task.examples || []).map(publicExample)
  };
}

function publicExample(example) {
  return {
    ...example,
    url: `/uploads/${example.filename}`
  };
}

function publicGeneration(generation) {
  return {
    ...generation,
    imageUrl: `/generated/${generation.filename}`,
    downloadUrl: `/generated/${generation.filename}`
  };
}

function normalizeTaskInput(body, base) {
  const name = cleanString(body.name);
  if (!name) {
    throw Object.assign(new Error("Task name is required."), { status: 400 });
  }

  return {
    ...base,
    name,
    description: cleanString(body.description),
    prompt: cleanString(body.prompt) || DEFAULT_PROMPT,
    allowedColors: parseAllowedColors(body.allowedColors),
    model: cleanString(body.model),
    aspectRatio: normalizeAspectRatio(body.aspectRatio, base.aspectRatio || defaultSettings.defaultAspectRatio),
    imageSize: normalizeImageSize(body.imageSize, base.imageSize || defaultSettings.defaultImageSize),
    updatedAt: new Date().toISOString()
  };
}

function filesToExamples(files = []) {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    createdAt: new Date().toISOString()
  }));
}

async function removeUploadedFiles(files = []) {
  await Promise.all(files.map((file) => safeUnlink(file.path)));
}

async function safeUnlink(file) {
  try {
    await fsp.unlink(file);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not remove ${file}:`, error.message);
    }
  }
}

function parseAllowedColors(value) {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(",");
    }
  }
  const parsed = Array.isArray(raw) ? raw : [];
  const colors = [...new Set(parsed.map(normalizeColor).filter(Boolean))];
  return colors.length ? colors : ["orange", "black"];
}

function normalizeColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return ALLOWED_COLORS.includes(color) ? color : "";
}

function normalizeAddressNumber(value) {
  const number = String(value || "").trim();
  return /^\d{1,12}$/.test(number) ? number : "";
}

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeAspectRatio(value, fallback) {
  const ratio = cleanString(value);
  return VALID_ASPECT_RATIOS.includes(ratio) ? ratio : fallback || defaultSettings.defaultAspectRatio;
}

function normalizeImageSize(value, fallback) {
  const size = cleanString(value);
  return VALID_IMAGE_SIZES.includes(size) ? size : fallback || defaultSettings.defaultImageSize;
}

function buildPrompt(template, variables) {
  const rendered = String(template || DEFAULT_PROMPT).replace(/\{\{\s*(addressNumber|cableColor|taskName)\s*\}\}/g, (_match, key) => variables[key] || "");
  return `${rendered}

Critical output checks:
- The cable color is ${variables.cableColor}.
- The only address number shown is ${variables.addressNumber}.
- The address number must be legible on a physical tag attached near the cable.
- Use the uploaded example images as visual references for the tap hardware, connectors, field label/tag, and real-world camera look.`;
}

async function readImageInput(file, mimeType) {
  try {
    const buffer = await fsp.readFile(file);
    return {
      type: "image",
      mime_type: mimeType || mimeFromExtension(file),
      data: buffer.toString("base64")
    };
  } catch (error) {
    console.warn(`Skipping missing reference image ${file}:`, error.message);
    return null;
  }
}

function getGoogleApiKey(settings) {
  return settings.googleApiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
}

function extensionFromMime(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  return "";
}

function mimeFromExtension(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function sanitizeProviderError(error) {
  const message = error?.message || "";
  if (/api key/i.test(message)) {
    return "Google AI rejected the API key. Check Settings and try again.";
  }
  if (/quota|billing|rate/i.test(message)) {
    return message;
  }
  return message || "Image generation failed.";
}
