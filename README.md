# QC Banana

Small Node.js app for generating field-style cable tap QC pictures with Google Gemini / Nano Banana image models.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Coolify

Use the included `Dockerfile`.

Recommended environment:

```bash
PORT=3000
DATA_DIR=/data
```

Mount a persistent volume at `/data`. The app stores settings, admin task reference images, and generated history there.

If you prefer a nested Coolify volume path such as `/data/qcbanana`, set `DATA_DIR=/data/qcbanana`. The container entrypoint creates the folder and fixes ownership before starting the app.

## App Setup

1. Open `Settings` and add the Google AI API key.
2. Open `Admin` and add reference images for the default task, or create new tasks with custom prompts.
3. Open `Generate`, enter the address number, choose orange or black, and generate.

Prompt templates can use:

```text
{{addressNumber}}
{{cableColor}}
{{taskName}}
```
