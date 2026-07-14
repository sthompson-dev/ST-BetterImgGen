# ST-BetterImgGen — Better Image Generation for SillyTavern

A powerful replacement extension for SillyTavern's built-in Stable Diffusion extension, providing full control over ComfyUI-powered image generation.

## Features

- **Dedicated Settings Modal** — Sidebar-based configuration with Main Config, Prompts, LoRA Handling, and Characters panels
- **Prompt Template System** — User-definable LLM instruction templates that convert chat context into SD prompts
- **LoRA Auto-Loading** — Automatic LoRA injection triggered by prompt keywords
- **Per-Character SD Tags** — Store and inject character-specific Stable Diffusion tags
- **Full Generation Pipeline** — From chat context to ComfyUI image output with swipe history
- **Wand Menu & Slash Commands** — `/bimg <mode>` for keyboard-driven generation

## Installation

ST-BetterImgGen consists of two parts that must both be installed:

### 1. Client-Side Extension

Place the extension folder into SillyTavern's third-party extensions directory:

```
SillyTavern/
├── public/
│   └── scripts/
│       └── extensions/
│           └── third-party/
│               └── better-img-gen/     ← copy everything here
│                   ├── manifest.json
│                   ├── index.js
│                   ├── style.css
│                   └── templates/
│                       └── settings.html
```

For Docker, ensure the `extensions` volume mount in your `docker-compose.yaml` maps to this directory:

```yaml
volumes:
  - "./extensions:/home/node/app/public/scripts/extensions/third-party"
```

### 2. Server Plugin

Copy `st-betterimgen.js` into SillyTavern's `plugins` directory:

```
SillyTavern/
├── plugins/
│   └── st-betterimgen.js               ← copy the plugin here
├── config/
│   └── config.yaml                     ← add setting below
├── data/
└── extensions/
```

For Docker, ensure the `plugins` volume mount is present:

```yaml
volumes:
  - "./plugins:/home/node/app/plugins"
```

### 3. Enable Server Plugins

Add this line to `config/config.yaml`:

```yaml
enableServerPlugins: true
```

### 4. Restart SillyTavern

After restarting:

- The extension appears as **"Better Image Generation"** in the extensions panel
- The server plugin mounts at `/api/plugins/st-betterimgen/` and handles all ComfyUI API calls
- The wand icon (fa-wand-sparkles) appears in the extensions bar for quick access

## Configuration

Open the settings modal from the wand icon in the extensions bar, or navigate to:
- **Extensions → Better Image Generation** in the SillyTavern settings

### First-Time Setup

1. Enter your ComfyUI URL (e.g. `http://127.0.0.1:8188`)
2. Click **"Test Connection"** to verify the connection
3. Load a workflow JSON file (File picker or paste)
4. Configure generation parameters (Model, VAE, Sampler, Steps, etc.)
5. Set your Style Prefix and Global Negative Prompt

## Usage

```
/bimg Scene     — Generate an image of the current scene
/bimg Portrait  — Generate a character portrait
```

Generation can also be triggered from the wand menu in the extensions bar.

## Development

Files are structured for direct use in SillyTavern's third-party extension system:

```
better-img-gen/
├── manifest.json                — Extension manifest
├── index.js                     — Main extension logic
├── style.css                    — UI styles
├── st-betterimgen.js            — ST server plugin (ComfyUI proxy)
├── templates/
│   └── settings.html            — Settings modal template
└── README.md
```

## License

MIT