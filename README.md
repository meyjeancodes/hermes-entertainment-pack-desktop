# Hermes Entertainment Pack — Desktop Plugin

Self-contained desktop plugin for the Hermes desktop app. Provides TV channels,
retro games, gallery, and music — same content as the dashboard version but for
the standalone desktop app.

## Install

```bash
# Clone this repo into your Hermes desktop plugins directory
git clone https://github.com/meyjeancodes/hermes-entertainment-pack-desktop.git \
  ~/.hermes/desktop-plugins/hermes-entertainment-pack
```

No other repo is required — the backend (`plugin_api.py`) ships in this one.
If you also want the web dashboard UI, install the sibling dashboard plugin
separately (see "Backend is self-contained" below).

## What's inside

- `plugin.js` — desktop plugin (loaded by Hermes desktop app from `desktop-plugins/`)
- `plugin_api.py` — self-contained FastAPI backend (`/asset/page/`, `/asset/game/`, `/asset/gallery/`, `/gallery-list`, `/gallery/upload`, `/video/{file}`, `/spotify/*`, `/discord/*`, `/social/*`)
- `public/*.html` — 7 TV channel HTML files
- `games/*.html` — 12 games (plus the NousBoy off-screen)
- `public/gallery/` — 46 gallery images

## Backend is self-contained

The desktop plugin ships its OWN `plugin_api.py`, so it does not need the
dashboard repo. `ctx.rest('/asset/...')` is served by this repo's backend under
`~/.hermes/desktop-plugins/hermes-entertainment-pack/`.

The dashboard repo (`hermes-entertainment-pack`) is a separate web plugin with
its own copy of the same backend — install it only if you also want the web UI.

## Make sure the plugin is enabled

```bash
hermes config set plugins.enabled '["hermes-entertainment-pack", ...]'
```

## Restart

Restart the Hermes desktop app after installing.
