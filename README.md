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
3. For each uploaded example, save the current address tag number shown in the photo. Optionally set the cable color visible in that photo.
4. Open `Generate`, enter the address number, choose orange or black, and generate.

When a task has tagged examples, generation picks one random tagged example and asks Nano Banana to preserve the photo while replacing only the saved tag number with the requested address number. If an example cable color matches the requested cable color, that example is preferred.

Prompt templates can use:

```text
{{addressNumber}}
{{cableColor}}
{{taskName}}
{{sourceTagNumber}}
{{sourceCableColor}}
```
