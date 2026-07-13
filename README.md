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

1. Clone this repo into `SillyTavern/extensions/third-party/better-img-gen/`
2. Restart SillyTavern
3. The extension will appear as "Better Image Generation" in the extensions panel

## Configuration

Open the settings modal from the wand icon in the extensions bar, or navigate to:
- **Extensions → Better Image Generation** in the SillyTavern settings

## Usage

```
/bimg Scene     — Generate an image of the current scene
/bimg Portrait  — Generate a character portrait
```

## Development

Files are structured for direct use in SillyTavern's third-party extension system:

```
extension.json  — Extension manifest
index.js        — Main extension logic
style.css       — UI styles
```

## License

MIT