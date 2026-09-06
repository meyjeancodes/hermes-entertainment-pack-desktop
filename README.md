# Hermes Entertainment Pack — Desktop Plugin

Self-contained desktop plugin for the Hermes desktop app. Provides TV channels,
retro games, gallery, and music — same content as the dashboard version but for
the standalone desktop app.

## Install

```bash
# Clone this repo into your Hermes desktop plugins directory
git clone https://github.com/meyjeancodes/hermes-entertainment-pack-desktop.git \
  ~/.hermes/desktop-plugins/hermes-entertainment-pack

# You ALSO need the dashboard plugin for the backend routes:
git clone https://github.com/meyjeancodes/hermes-entertainment-pack.git \
  ~/.hermes/plugins/entertainment
```

## What's inside

- `plugin.js` — desktop plugin (loaded by Hermes desktop app from `desktop-plugins/`)
- `plugin_api.py` — FastAPI backend with `/asset/page/`, `/asset/game/`, `/asset/gallery/`, `/gallery-list`, `/teletext/news` routes
- `public/*.html` — 7 TV channel HTML files
- `games/*.html` — 5 retro games
- `public/gallery/` — 41 gallery images

## Why two repos?

The desktop plugin (`plugin.js`) calls `ctx.rest('/asset/page/...')` to load
channels and games. Those routes are served by the dashboard plugin's
`plugin_api.py`. Both repos are needed — this repo provides the desktop UI and
assets, the dashboard repo provides the backend.

## Make sure the plugin is enabled

```bash
hermes config set plugins.enabled '["hermes-entertainment-pack", ...]'
```

## Restart

Restart the Hermes desktop app after installing.
