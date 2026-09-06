"""Entertainment Pack plugin backend API routes.

Mounted at /api/plugins/hermes-entertainment-pack/ by the dashboard plugin system.
"""

from __future__ import annotations

import sys
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "plugin": "hermes-entertainment-pack", "version": "1.0.0"}


# ── Local video streaming (mp4) ──────────────────────────────────────────────
# The dashboard's static asset route (/dashboard-plugins/...) blocks .mp4 by
# design (suffix allowlist), so we serve promo videos from this plugin API
# endpoint instead. The frontend fetches with the session token and renders via
# a blob URL (see VideoPlayer in EntertainmentPage.tsx).
_VIDEO_DIR = os.path.join(os.path.dirname(__file__), "dist")


@router.get("/video/{filename}")
async def serve_video(filename: str):
    # Restrict to the dist/ dir; block path traversal.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.abspath(os.path.join(_VIDEO_DIR, filename))
    if not path.startswith(os.path.abspath(_VIDEO_DIR)) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type="video/mp4", filename=filename)


# ── Spotify passthrough endpoints ─────────────────────────────────────────────

def _spotify_client():
    """Import and return a SpotifyClient, adding hermes-agent to sys.path if needed."""
    hermes_agent = os.path.expanduser("~/.hermes/hermes-agent")
    if hermes_agent not in sys.path:
        sys.path.insert(0, hermes_agent)
    from plugins.spotify.client import SpotifyClient, SpotifyAuthRequiredError, SpotifyAPIError
    return SpotifyClient(), SpotifyAuthRequiredError, SpotifyAPIError


@router.get("/spotify/now-playing")
async def spotify_now_playing():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})

    try:
        data = client.get_currently_playing()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required", "message": "Run hermes auth spotify to connect."})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"message": str(exc)})

    # Normalise Spotify's now-playing response into the shape the frontend expects
    if not data or data.get("empty"):
        return {"playing": False, "track": None, "progress_ms": 0, "device": None}

    item = data.get("item") or {}
    artists = [a.get("name", "") for a in item.get("artists", [])]
    images = item.get("album", {}).get("images", [])
    image_url = images[0].get("url") if images else None
    device = (data.get("device") or {}).get("name")

    return {
        "playing": data.get("is_playing", False),
        "track": {
            "name": item.get("name", ""),
            "artists": artists,
            "album": item.get("album", {}).get("name", ""),
            "image": image_url,
            "url": item.get("external_urls", {}).get("spotify", ""),
            "duration_ms": item.get("duration_ms", 0),
        },
        "progress_ms": data.get("progress_ms", 0),
        "device": device,
        "shuffle_state": data.get("shuffle_state"),
        "repeat_state": data.get("repeat_state"),
    }


@router.post("/spotify/play")
async def spotify_play():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.start_playback()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


class SeekPayload(BaseModel):
    position_ms: int


@router.post("/spotify/seek")
async def spotify_seek(payload: SeekPayload):
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.seek(position_ms=max(0, int(payload.position_ms)))
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


@router.post("/spotify/pause")
async def spotify_pause():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.pause_playback()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


@router.post("/spotify/next")
async def spotify_next():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.skip_next()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


@router.post("/spotify/previous")
async def spotify_previous():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.skip_previous()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


class ShufflePayload(BaseModel):
    state: bool


@router.post("/spotify/shuffle")
async def spotify_shuffle(payload: ShufflePayload):
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.set_shuffle(state=payload.state)
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


class RepeatPayload(BaseModel):
    state: str


@router.post("/spotify/repeat")
async def spotify_repeat(payload: RepeatPayload):
    valid = {"off", "context", "track"}
    if payload.state not in valid:
        raise HTTPException(status_code=400, detail={"message": f"state must be one of: {valid}"})
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.set_repeat(state=payload.state)
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


class VolumePayload(BaseModel):
    volume: int


@router.post("/spotify/volume")
async def spotify_volume(payload: VolumePayload):
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.set_volume(volume_percent=max(0, min(100, payload.volume)))
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


@router.get("/spotify/devices")
async def spotify_devices():
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        data = client.get_devices()
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})
    devices = (data or {}).get("devices", [])
    return {
        "devices": [
            {
                "id": d.get("id"),
                "name": d.get("name", "Unknown"),
                "type": d.get("type", ""),
                "is_active": bool(d.get("is_active")),
                "volume_percent": d.get("volume_percent"),
            }
            for d in devices
        ]
    }


class TransferPayload(BaseModel):
    device_id: str


@router.post("/spotify/transfer")
async def spotify_transfer(payload: TransferPayload):
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        return client.transfer_playback(device_id=payload.device_id, play=False)
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


@router.get("/spotify/recently-played")
async def spotify_recently_played(limit: int = 8):
    try:
        client, SpotifyAuthRequiredError, SpotifyAPIError = _spotify_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"message": str(exc)})
    try:
        data = client.get_recently_played(limit=limit)
    except SpotifyAuthRequiredError:
        raise HTTPException(status_code=401, detail={"error": "auth_required"})
    except SpotifyAPIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"message": str(exc)})
    items = (data or {}).get("items", [])
    seen: set = set()
    result = []
    for item in items:
        track = item.get("track") or {}
        name = track.get("name", "")
        if not name or name in seen:
            continue
        seen.add(name)
        artists = [a.get("name", "") for a in track.get("artists", [])]
        result.append({
            "name": name,
            "artists": artists,
            "album": (track.get("album") or {}).get("name", ""),
            "duration_ms": track.get("duration_ms", 0),
            "played_at": item.get("played_at", ""),
        })
    return result


# ── Apple Music passthrough endpoints ─────────────────────────────────────────
# Apple Music has no OAuth helper in hermes auth, so we read a MusicKit developer
# token from the environment. With it we can hit the Apple Music API (catalog,
# recently played, search). Playback itself is handed off to the Music app via
# the music:// URL scheme, since full in-tab playback needs a user token from
# MusicKit JS (Apple Developer account). When no token is set we return a
# clear "connect" signal instead of faking data.
import urllib.request as _am_req
import urllib.error as _am_err
import json as _am_json

_APPLE_TOKEN = os.environ.get("APPLE_MUSIC_DEVELOPER_TOKEN")

# Apple Music catalog/library endpoints use the developer token as a Bearer
# header and require an Accept: application/json plus a music-user-token header
# for user-specific data. We hit the public catalog + the recently-played
# library endpoint (needs a user token, gracefully degrades if absent).
_AM_BASE = "https://api.music.apple.com/v1"


def _am_call(path, user_token=None):
    """GET an Apple Music API path; return parsed JSON or raise RuntimeError."""
    url = _AM_BASE + path
    req = _am_req.Request(url, headers={
        "Authorization": f"Bearer {_APPLE_TOKEN}",
        "Accept": "application/json",
    })
    if user_token:
        req.add_header("Music-User-Token", user_token)
    with _am_req.urlopen(req, timeout=10) as resp:
        return _am_json.loads(resp.read().decode("utf-8"))


def _am_track(obj):
    """Normalise an Apple Music song resource to the frontend track shape."""
    attrs = obj.get("attributes", {})
    artists = [a.get("name", "") for a in attrs.get("artistName", "").split(", ") if a]
    if not artists and attrs.get("artistName"):
        artists = [attrs["artistName"]]
    artwork = attrs.get("artwork", {})
    url = None
    if artwork and artwork.get("url"):
        # Apple artwork URLs are templated with {w}x{h}; substitute a real size.
        url = artwork["url"].replace("{w}", "300").replace("{h}", "300")
    return {
        "id": obj.get("id"),
        "name": attrs.get("name", ""),
        "artists": artists or [attrs.get("artistName", "")],
        "album": attrs.get("albumName", ""),
        "image": url,
        "url": attrs.get("url", ""),  # opens in Music app / music.apple.com
        "duration_ms": int((attrs.get("durationInMillis", 0) or 0)),
    }


@router.get("/apple/status")
async def apple_status():
    return {"connected": bool(_APPLE_TOKEN), "provider": "apple-music"}


@router.get("/apple/recently-played")
async def apple_recently_played(limit: int = 12):
    if not _APPLE_TOKEN:
        raise HTTPException(status_code=401, detail={
            "error": "auth_required",
            "message": "Set APPLE_MUSIC_DEVELOPER_TOKEN to connect Apple Music.",
        })
    try:
        # recently-played is a library endpoint; needs a user token, but we try
        # the catalog-less history endpoint and degrade gracefully if 401.
        user_token = os.environ.get("APPLE_MUSIC_USER_TOKEN")
        data = _am_call(
            f"/me/recent/played?limit={limit}",
            user_token=user_token,
        )
        items = (data or {}).get("data", [])
        result = []
        seen = set()
        for it in items:
            tr = _am_track(it)
            if not tr["name"] or tr["name"] in seen:
                continue
            seen.add(tr["name"])
            result.append(tr)
        return result
    except _am_err.HTTPError as exc:
        # 401/403 on the user endpoint: developer token is valid but no user
        # library access — return empty with a note rather than erroring hard.
        if exc.code in (401, 403):
            return []
        raise HTTPException(status_code=502, detail={"message": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)})


# ── Discord passthrough endpoints ─────────────────────────────────────────────

import json as _json
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional as _Opt

_DISCORD_API_BASE = "https://discord.com/api/v10"


def _discord_bot_token() -> _Opt[str]:
    return os.getenv("DISCORD_BOT_TOKEN", "").strip() or None


def _discord_api(method: str, path: str, token: str, params: _Opt[dict] = None, body: _Opt[dict] = None):
    url = f"{_DISCORD_API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    data = _json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "Hermes-Entertainment/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status == 204:
            return None
        return _json.loads(resp.read().decode("utf-8"))


@router.get("/discord/guilds")
async def discord_guilds():
    token = _discord_bot_token()
    if not token:
        raise HTTPException(status_code=401, detail={"error": "DISCORD_BOT_TOKEN not configured. Add it to ~/.hermes/.env and restart."})
    try:
        guilds = _discord_api("GET", "/users/@me/guilds", token)
        return [{"id": g["id"], "name": g["name"], "icon": g.get("icon")} for g in guilds]
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail={"error": f"Discord API error {exc.code}"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": str(exc)})


@router.get("/discord/channels")
async def discord_channels(guild_id: str):
    token = _discord_bot_token()
    if not token:
        raise HTTPException(status_code=401, detail={"error": "DISCORD_BOT_TOKEN not configured."})
    try:
        channels = _discord_api("GET", f"/guilds/{guild_id}/channels", token)
        # Include categories (4) and text/announcement channels (0, 5)
        result = [
            {
                "id": c["id"],
                "name": c["name"],
                "type": c["type"],
                "position": c.get("position", 0),
                "parent_id": c.get("parent_id"),
            }
            for c in channels if c["type"] in (0, 4, 5)
        ]
        result.sort(key=lambda c: (c.get("position") or 0))
        return result
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail={"error": f"Discord API error {exc.code}"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": str(exc)})


@router.get("/discord/messages")
async def discord_messages(channel_id: str, limit: int = 50, after: _Opt[str] = None):
    token = _discord_bot_token()
    if not token:
        raise HTTPException(status_code=401, detail={"error": "DISCORD_BOT_TOKEN not configured."})
    try:
        params: dict = {"limit": str(min(limit, 100))}
        if after:
            params["after"] = after
        msgs = _discord_api("GET", f"/channels/{channel_id}/messages", token, params=params)
        result = []
        for m in (msgs or []):
            a = m.get("author", {})
            attachments = [
                {
                    "id": att.get("id"),
                    "url": att.get("url"),
                    "filename": att.get("filename"),
                    "content_type": att.get("content_type", ""),
                    "width": att.get("width"),
                    "height": att.get("height"),
                    "size": att.get("size"),
                }
                for att in m.get("attachments", [])
            ]
            embeds = [
                {
                    "type": e.get("type"),
                    "title": e.get("title"),
                    "description": e.get("description"),
                    "url": e.get("url"),
                    "color": e.get("color"),
                    "image": e.get("image", {}).get("url") if e.get("image") else None,
                    "thumbnail": e.get("thumbnail", {}).get("url") if e.get("thumbnail") else None,
                    "author_name": e.get("author", {}).get("name") if e.get("author") else None,
                    "footer_text": e.get("footer", {}).get("text") if e.get("footer") else None,
                }
                for e in m.get("embeds", [])
            ]
            result.append({
                "id": m["id"],
                "content": m.get("content", ""),
                "author": {
                    "id": a.get("id", ""),
                    "username": a.get("username", ""),
                    "discriminator": a.get("discriminator", "0"),
                    "avatar": a.get("avatar"),
                    "bot": a.get("bot", False),
                },
                "timestamp": m.get("timestamp", ""),
                "edited_timestamp": m.get("edited_timestamp"),
                "channel_id": channel_id,
                "attachments": attachments,
                "embeds": embeds,
                "mention_everyone": m.get("mention_everyone", False),
                "reactions": [
                    {"emoji": r.get("emoji", {}).get("name", ""), "count": r.get("count", 0)}
                    for r in m.get("reactions", [])
                ],
            })
        return result
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail={"error": f"Discord API error {exc.code}"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": str(exc)})


class DiscordSendPayload(BaseModel):
    channel_id: str
    content: str


# ── Teletext news (BBC RSS) ────────────────────────────────────────────────────

import xml.etree.ElementTree as _ET
import html as _html

_TELETEXT_FEEDS = {
    "top":      "https://feeds.bbci.co.uk/news/rss.xml",
    "business": "https://feeds.bbci.co.uk/news/business/rss.xml",
    "tech":     "https://feeds.bbci.co.uk/news/technology/rss.xml",
}


@router.get("/teletext/news")
async def teletext_news(category: str = "top"):
    url = _TELETEXT_FEEDS.get(category, _TELETEXT_FEEDS["top"])
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        root = _ET.fromstring(raw)
        headlines = [
            _html.unescape(t.text.strip())
            for item in root.findall(".//item")[:10]
            if (t := item.find("title")) is not None and t.text
        ]
        return {"headlines": headlines}
    except Exception as exc:
        return {"headlines": [], "error": str(exc)}


# ── Static asset serving for desktop plugin ─────────────────────────────────
# The dashboard resolves assets via PLUGIN_URL (e.g. /public/gallery/x.jpg),
# but the desktop plugin has no PLUGIN_URL — it reaches the backend only
# through ctx.rest, which is JSON-only. These routes serve the same local
# binaries the dashboard uses, scoped to this plugin's own namespace, with
# path-traversal protection. The desktop plugin fetches them via ctx.rest and
# renders through blob URLs (the same trick the dashboard's VideoPlayer uses).

_DASHBOARD_DIR = os.path.dirname(__file__)

# Reserved/modified asset to skip in the gallery grid.
_GALLERY_SKIP = {"the-artist.jpg"}


def _safe_file(subdir: str, filename: str, media_type: str):
    """Resolve `filename` under dashboard/<subdir>; block traversal."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    base = os.path.abspath(os.path.join(_DASHBOARD_DIR, subdir))
    path = os.path.abspath(os.path.join(base, filename))
    if not path.startswith(base) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(path, media_type=media_type)


@router.get("/games/{filename}")
async def serve_game(filename: str):
    # .html game shells
    return _safe_file("games", filename, "text/html")


@router.get("/gallery/{filename}")
async def serve_gallery_image(filename: str):
    lower = filename.lower()
    if lower.endswith((".jpg", ".jpeg")):
        mt = "image/jpeg"
    elif lower.endswith(".png"):
        mt = "image/png"
    elif lower.endswith(".gif"):
        mt = "image/gif"
    elif lower.endswith(".webp"):
        mt = "image/webp"
    else:
        mt = "application/octet-stream"
    return _safe_file(os.path.join("public", "gallery"), filename, mt)


@router.get("/page/{filename}")
async def serve_page(filename: str):
    # weather.html, vapor.html, artemis.html, channel-*.html, etc.
    return _safe_file("public", filename, "text/html")


@router.get("/gallery-list")
async def gallery_list():
    """Return the list of gallery image filenames so the plugin renders a grid
    without hardcoding paths."""
    import os as _os

    gal = os.path.join(_DASHBOARD_DIR, "public", "gallery")
    if not os.path.isdir(gal):
        return {"images": []}
    skip = _GALLERY_SKIP  # reserved/modified asset; skip in grid
    imgs = sorted(
        f for f in os.listdir(gal)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp"))
        and f not in skip
    )
    return {"images": imgs}


from fastapi import UploadFile, File as _FastAPIFile


@router.post("/gallery/upload")
async def gallery_upload(file: UploadFile = _FastAPIFile(...)):
    """Upload a new gallery image (jpg/png/gif/webp) into public/gallery/.
    Persists across reloads. Returns the new filename and refreshed list."""
    import os as _os
    import re as _re

    raw = file.filename or "upload.bin"
    # Keep only a safe basename; avoid collisions with a timestamp suffix.
    base, ext = _os.path.splitext(_os.path.basename(raw))
    ext = ext.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        raise HTTPException(status_code=400, detail={"error": "Unsupported type", "message": "Use jpg, png, gif, or webp."})
    safe_base = _re.sub(r"[^a-z0-9_-]", "-", base.lower()) or "image"
    stamp = _os.urandom(3).hex()
    fname = f"{safe_base}-{stamp}{ext}"
    gal = _os.path.join(_DASHBOARD_DIR, "public", "gallery")
    _os.makedirs(gal, exist_ok=True)
    dest = _os.path.abspath(_os.path.join(gal, fname))
    if not dest.startswith(_os.path.abspath(gal)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 25 MB).")
    with open(dest, "wb") as fh:
        fh.write(data)
    # Refresh the list.
    imgs = sorted(
        f for f in _os.listdir(gal)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")) and f not in _GALLERY_SKIP
    )
    return {"filename": fname, "images": imgs}


# ── JSON-enveloped asset doors (desktop plugin surface) ──────────────────────
# The dashboard fetches assets over plain HTTP (/dashboard-plugins/...), but the
# DESKTOP plugin can only reach this backend through ctx.rest, and the Electron
# bridge JSON-parses every response body (apps/desktop/electron/main.ts). A raw
# FileResponse therefore always throws there. These endpoints return the same
# bytes wrapped in JSON so the desktop plugin can rebuild a blob/data URL.


def _asset_payload(subdir: str, filename: str, media_type: str, as_text: bool) -> dict:
    """Resolve an asset under dashboard/<subdir> and return it JSON-encoded."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    base = os.path.abspath(os.path.join(_DASHBOARD_DIR, subdir))
    path = os.path.abspath(os.path.join(base, filename))
    if not path.startswith(base) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Asset not found")
    if as_text:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return {"name": filename, "mediaType": media_type, "encoding": "utf-8", "content": fh.read()}
    import base64 as _b64

    with open(path, "rb") as fh:
        return {
            "name": filename,
            "mediaType": media_type,
            "encoding": "base64",
            "content": _b64.b64encode(fh.read()).decode("ascii"),
        }


@router.get("/asset/page/{filename}")
async def asset_page(filename: str):
    """HTML channel page as JSON text (desktop)."""
    return _asset_payload("public", filename, "text/html", as_text=True)


@router.get("/asset/game/{filename}")
async def asset_game(filename: str):
    """HTML game shell as JSON text (desktop)."""
    return _asset_payload("games", filename, "text/html", as_text=True)


@router.get("/asset/gallery/{filename}")
async def asset_gallery(filename: str, w: int = 0):
    """Gallery image as base64 JSON (desktop).

    ``w`` downscales to that pixel width before encoding. The grid asks for
    ``?w=400``: the full set is ~47 MB (~63 MB once base64'd), which is far too
    much to push over the Electron IPC bridge for a thumbnail wall. The
    lightbox omits ``w`` and gets the original bytes.
    """
    lower = filename.lower()
    if lower.endswith((".jpg", ".jpeg")):
        mt = "image/jpeg"
    elif lower.endswith(".png"):
        mt = "image/png"
    elif lower.endswith(".gif"):
        mt = "image/gif"
    elif lower.endswith(".webp"):
        mt = "image/webp"
    else:
        raise HTTPException(status_code=404, detail="Asset not found")

    if w and w > 0:
        thumb = _thumbnail_payload(filename, w)
        if thumb is not None:
            return thumb

    return _asset_payload(os.path.join("public", "gallery"), filename, mt, as_text=False)


def _thumbnail_payload(filename: str, width: int) -> dict | None:
    """Downscale a gallery image to `width` and return it base64/JPEG.

    Returns None when Pillow is unavailable or the image can't be decoded, so
    the caller falls back to serving the original bytes.
    """
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    base = os.path.abspath(os.path.join(_DASHBOARD_DIR, "public", "gallery"))
    path = os.path.abspath(os.path.join(base, filename))
    if not path.startswith(base) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Asset not found")

    try:
        import base64 as _b64
        import io as _io

        from PIL import Image
    except Exception:
        return None

    width = max(64, min(int(width), 2000))
    # Pillow >=10 moved the filter enum to Image.Resampling; keep both paths.
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", 1)
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            if im.width > width:
                im = im.resize((width, max(1, round(im.height * width / im.width))), resample)
            buf = _io.BytesIO()
            im.save(buf, format="JPEG", quality=82, optimize=True)
    except Exception:
        return None

    return {
        "name": filename,
        "mediaType": "image/jpeg",
        "encoding": "base64",
        "content": _b64.b64encode(buf.getvalue()).decode("ascii"),
    }


@router.post("/discord/send")
async def discord_send(payload: DiscordSendPayload):
    token = _discord_bot_token()
    if not token:
        raise HTTPException(status_code=401, detail={"error": "DISCORD_BOT_TOKEN not configured."})
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail={"error": "Message content cannot be empty."})
    try:
        msg = _discord_api("POST", f"/channels/{payload.channel_id}/messages", token,
                           body={"content": payload.content[:2000]})
        return {"success": True, "id": msg["id"] if msg else None}
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail={"error": f"Discord API error {exc.code}"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": str(exc)})
