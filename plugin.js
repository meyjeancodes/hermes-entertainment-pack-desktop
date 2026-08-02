// ~/.hermes/desktop-plugins/hermes-entertainment-pack/plugin.js
//
// Desktop port of the Hermes Entertainment Pack (TV & Games, Discord, Gallery,
// Music). Re-authored against @hermes/plugin-sdk — the dashboard's compiled
// dist/index.js can never run here (it needs window.__HERMES_PLUGIN_SDK__ at
// build time and a manifest).
//
// THREE HARD CONSTRAINTS discovered from the installed app source; do not
// "simplify" past them:
//
//  1. `ctx.rest` is scoped BY CONSTRUCTION to /api/plugins/<plugin.id>/ and it
//     rejects '..' (apps/desktop/src/hermes.ts). The backend mounts under the
//     dashboard manifest NAME, so this plugin's id MUST be
//     'hermes-entertainment-pack' — and the containing folder must match the id.
//  2. The Electron bridge JSON-parses every REST response body
//     (electron/main.ts fetchJson). Raw bytes / HTML through ctx.rest always
//     throw. Local assets therefore come back JSON-enveloped from the
//     /asset/page, /asset/game and /asset/gallery routes in plugin_api.py.
//  3. `atom` exported by the SDK is a NANOSTORES atom, not a React hook.
//     Calling it inside a component makes a new store every render. Component
//     state uses React.useState; nanostores are only for host.state.

import React from 'react'
import {
  host,
  haptic,
  cn,
  useQuery,
  ScrollArea,
  EmptyState,
  ErrorState,
  GlyphSpinner,
} from '@hermes/plugin-sdk'

const ID = 'hermes-entertainment-pack'

const h = React.createElement

// ── Shared TV state (main pane <-> floating mini-player) ─────────────────────
// The two panes are separate React trees (separate register() calls), so they
// don't share hooks. A tiny module-level store keeps them in sync: both read
// tvState and call tvSet to mutate; a listener set forces re-render in each.
const tvState = { idx: 1, powerOn: true, size: 420, floating: false, floatingMode: 'tv' }
const tvListeners = new Set()
function tvSet(patch) {
  Object.assign(tvState, patch)
  tvListeners.forEach(fn => { try { fn() } catch { /* ignore */ } })
}
function tvUse() {
  const [, force] = React.useReducer(c => c + 1, 0)
  React.useEffect(() => {
    tvListeners.add(force)
    return () => tvListeners.delete(force)
  }, [])
  return tvState
}
// Disposer for the floating pane, captured on register so the X button can close it.
let floatingDispose = null
// Captured plugin storage (set in register) for persisting TV prefs.
let PLUGIN_STORAGE = null
const TV_STORE_KEY = 'tv-prefs'
function tvLoad() {
  if (!PLUGIN_STORAGE) return
  const saved = PLUGIN_STORAGE.get(TV_STORE_KEY, null)
  if (saved && typeof saved.idx === 'number') Object.assign(tvState, saved)
}
function tvSave() {
  if (!PLUGIN_STORAGE) return
  PLUGIN_STORAGE.set(TV_STORE_KEY, { idx: tvState.idx, powerOn: tvState.powerOn, size: tvState.size })
}
// Wrap tvSet to persist on meaningful changes.
function tvSetPersist(patch) { tvSet(patch); tvSave() }

// ── Channel reconfig (reorder / hide, persisted) ─────────────────────────────
const CH_ORDER_KEY = 'channel-order'
const CH_HIDDEN_KEY = 'channel-hidden'
let channelOrder = null   // array of channel ids in display order
let channelHidden = null // Set of hidden ids
function channelsLoad() {
  if (!PLUGIN_STORAGE) return
  const ord = PLUGIN_STORAGE.get(CH_ORDER_KEY, null)
  if (Array.isArray(ord) && ord.length) {
    // keep any new channels appended
    const known = new Set(CHANNELS.map(c => c.id))
    channelOrder = ord.filter(id => known.has(id)).concat(CHANNELS.map(c => c.id).filter(id => !ord.includes(id)))
  } else {
    channelOrder = CHANNELS.map(c => c.id)
  }
  const hid = PLUGIN_STORAGE.get(CH_HIDDEN_KEY, null)
  channelHidden = new Set(Array.isArray(hid) ? hid : [])
}
function channelsVisible() {
  return (channelOrder || CHANNELS.map(c => c.id)).filter(id => !channelHidden.has(id))
}
function channelsSave() {
  if (!PLUGIN_STORAGE) return
  PLUGIN_STORAGE.set(CH_ORDER_KEY, channelOrder)
  PLUGIN_STORAGE.set(CH_HIDDEN_KEY, Array.from(channelHidden))
}
// Reorder CHANNELS display list based on persisted order/hidden, used by views.
function activeChannels() {
  if (!channelOrder) channelsLoad()
  return channelsVisible().map(id => CHANNELS.find(c => c.id === id)).filter(Boolean)
}

// Global keyboard shortcuts for the TV (arrows = channel, space = power, P = pop).
function useTvKeys(onPop) {
  React.useEffect(() => {
    const handler = (e) => {
      const tag = (e.target && e.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') { tvSet({ idx: (tvState.idx + 1) % activeChannels().length }); e.preventDefault() }
      else if (e.key === 'ArrowLeft') { tvSet({ idx: (tvState.idx - 1 + activeChannels().length) % activeChannels().length }); e.preventDefault() }
      else if (e.key === ' ') { tvSet({ powerOn: !tvState.powerOn }); e.preventDefault() }
      else if (e.key === 'p' || e.key === 'P') { if (onPop) onPop() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPop])
}

// ── Channel lineup — mirrors dashboard src/pages/EntertainmentPage.tsx ───────
// `page` = local HTML served JSON-enveloped by the backend; `src` = remote URL
// embedded directly.
const CHANNELS = [
  { id: 'ch1', name: 'Hackathon Anime', page: 'hackathon-anime.html' },
  { id: 'ch2', name: 'Signal', page: 'twitter-embed.html' },
  { id: 'ch3', name: 'Weather Retro', page: 'weather.html' },
  { id: 'ch4', name: 'Nous Network', page: 'nous-network-tweet.html' },
  { id: 'ch5', name: 'HNN Teletext', teletext: true },
  { id: 'ch6', name: 'Vapor FM', page: 'vapor.html' },
  { id: 'ch7', name: 'Ballad of Hermes', page: 'ballad-hermes.html' },
  { id: 'ch8', name: 'Nous Promo', page: 'channel-promo-tweet.html' },
]

const GAMES = [
  { id: 'g1', name: 'Pong', file: 'pong.html' },
  { id: 'g2', name: 'Tetris', file: 'tetris.html' },
  { id: 'g3', name: 'Space Raid', file: 'space.html' },
  { id: 'g4', name: 'Flappy Bird', src: 'https://flappybird.io' },
  { id: 'g5', name: 'Snake', file: 'snake.html' },
  { id: 'g6', name: '2048', file: '2048.html' },
]

// ── asset helpers ────────────────────────────────────────────────────────────

/** Fetch a JSON-enveloped local asset and return a renderable value.
 *  text  -> the raw markup (wrapped into a blob URL by useHtmlAsset)
 *  base64 -> a data: URL (for <img>) */
async function fetchAsset(ctx, path) {
  const res = await ctx.rest(path)
  if (!res || typeof res.content !== 'string') throw new Error('bad asset payload')
  if (res.encoding === 'base64') return `data:${res.mediaType};base64,${res.content}`
  return res.content
}

/** Load a local HTML asset and expose it as a BLOB URL.
 *
 *  Deliberately NOT srcDoc: a srcDoc iframe gets an opaque (null) origin, and
 *  the X/Twitter widgets.js embeds used by half the channel lineup refuse to
 *  hydrate there — the frame just stays blank. A blob: URL inherits the
 *  creating document's origin, so third-party embed scripts load normally.
 *  Returns { url, error, loading }. */
function useHtmlAsset(ctx, path) {
  const [state, setState] = React.useState({ url: null, error: null, loading: !!path })

  React.useEffect(() => {
    if (!path) {
      setState({ url: null, error: null, loading: false })
      return
    }
    let live = true
    let objectUrl = null
    setState({ url: null, error: null, loading: true })

    fetchAsset(ctx, path)
      .then(markup => {
        if (!live) return
        objectUrl = URL.createObjectURL(new Blob([markup], { type: 'text/html' }))
        setState({ url: objectUrl, error: null, loading: false })
      })
      .catch(error => live && setState({ url: null, error: String(error), loading: false }))

    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ctx, path])

  return state
}


// ── TV screen ────────────────────────────────────────────────────────────────
// The dashboard renders local channels from a same-origin URL; here the markup
// arrives over REST and is handed to the iframe as a blob: URL (see
// useHtmlAsset — blob keeps a real origin so X/YouTube embed scripts run).

function Screen({ ctx, channel, powerOn }) {
  const asset = useHtmlAsset(ctx, powerOn && channel.page ? `/asset/page/${channel.page}` : null)

  // A wrapper that centers the 16:9 video inside the 16:9 screen and keeps it
  // from overflowing (YouTube's own chrome letterboxes safely within). X/Twitter
  // embeds are given a max-height + internal scroll so a tall tweet card can
  // never blow past the bezel.
  const Iframe = (src, extra) => h('div', {
    className: 'absolute inset-0 flex items-center justify-center bg-black',
    style: { overflow: 'hidden', contain: 'paint' },
  }, h('iframe', Object.assign({
    src,
    title: channel.name,
    className: 'h-full w-full border-0',
    style: { aspectRatio: '16 / 9', maxWidth: '100%', maxHeight: '100%' },
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowFullScreen: true,
  }, extra || {})))

  const body = (() => {
    if (!powerOn) {
      return h('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: { background: 'radial-gradient(circle at 50% 45%, #16161d 0%, #000 78%)' } },
        h('span', {
          className: 'font-mono uppercase',
          style: { fontSize: '0.6rem', letterSpacing: '0.5em', color: 'rgba(255,255,255,0.18)' } },
          'standby'))
    }
    if (channel.teletext) return h(Teletext, { ctx })
    if (channel.src) return Iframe(channel.src)
    if (asset.loading) {
      return h('div', { className: 'absolute inset-0 flex items-center justify-center' }, h(GlyphSpinner, {}))
    }
    if (asset.error) {
      return h('div', {
        className: 'absolute inset-0 flex items-center justify-center font-mono',
        style: { fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)' } }, 'no signal')
    }
    return Iframe(asset.url)
  })()

  // Keyed by channel so each switch fades in cleanly instead of flickering.
  return h('div', {
    key: channel.id,
    className: 'absolute inset-0',
    style: {
      animation: 'hermesTvFade 260ms ease',
    },
  }, body)
}

// HNN Teletext — live headlines from the backend's /teletext/news route.
function Teletext({ ctx }) {
  const { data, isLoading, error } = useQuery({
    queryKey: [ID, 'teletext'],
    queryFn: () => ctx.rest('/teletext/news'),
    retry: false,
    refetchInterval: 120000,
  })
  const items = (data && (data.items || data.headlines || data.news)) || []
  return h('div', {
    className: 'absolute inset-0 overflow-hidden p-4 font-mono',
    style: { background: '#000033', color: '#7cf3a0' },
  }, [
    h('div', {
      key: 'hd',
      className: 'mb-3 flex items-center justify-between',
      style: { fontSize: '0.62rem', letterSpacing: '0.35em' },
    }, [
      h('span', { key: 'a', style: { color: '#fbbf24' } }, 'HNN TELETEXT'),
      h('span', { key: 'b', style: { color: 'rgba(255,255,255,0.4)' } }, 'P100'),
    ]),
    isLoading
      ? h('div', { key: 'l', style: { fontSize: '0.66rem' } }, 'loading feed…')
      : error
        ? h('div', { key: 'e', style: { fontSize: '0.66rem', color: '#fca5a5' } }, 'feed unavailable')
        : h('div', { key: 'i', className: 'space-y-1.5' }, items.slice(0, 9).map((it, i) =>
            h('div', { key: i, style: { fontSize: '0.66rem', lineHeight: 1.5 } }, [
              h('span', { key: 'n', style: { color: '#fbbf24' } }, String(i + 1).padStart(2, '0') + '  '),
              typeof it === 'string' ? it : (it.title || it.headline || ''),
            ]),
          )),
  ])
}

// ── TV cabinet: antenna + glassy molded bezel ────────────────────────────────

function Antenna({ powerOn }) {
  const tip = powerOn ? '#4ade80' : 'rgba(255,255,255,0.18)'
  return h('div', { className: 'relative mx-auto', style: { width: 220, height: 54 } },
    h('svg', {
      viewBox: '0 0 220 54',
      width: 220,
      height: 54,
      style: { display: 'block', overflow: 'visible' },
    }, [
      h('line', { key: 'l', x1: 110, y1: 52, x2: 34, y2: 8, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2.5, strokeLinecap: 'round' }),
      h('line', { key: 'r', x1: 110, y1: 52, x2: 186, y2: 8, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2.5, strokeLinecap: 'round' }),
      h('circle', { key: 'lt', cx: 34, cy: 8, r: 4, fill: tip, style: { filter: powerOn ? 'drop-shadow(0 0 6px #4ade80)' : 'none' } }),
      h('circle', { key: 'rt', cx: 186, cy: 8, r: 4, fill: tip, style: { filter: powerOn ? 'drop-shadow(0 0 6px #4ade80)' : 'none' } }),
      h('ellipse', { key: 'b', cx: 110, cy: 52, rx: 20, ry: 6, fill: 'rgba(255,255,255,0.10)' }),
    ]),
  )
}

function TvCabinet({ ctx, channel, channelIdx, powerOn, onPower, size, children }) {
  return h('div', { className: 'mx-auto w-full', style: { maxWidth: size || 880 } }, [
    h(Antenna, { key: 'ant', powerOn }),
    // housing — elevated glass, matching the dashboard bezel redo
    h('div', {
      key: 'house',
      className: 'relative',
      style: {
        borderRadius: 28,
        background: 'rgba(12,12,18,0.72)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.03)',
        padding: '16px 16px 20px',
      },
    }, [
      h('div', {
        key: 'ring',
        className: 'pointer-events-none absolute inset-0',
        style: { borderRadius: 28, boxShadow: 'inset 0 0 0 1px rgba(56,189,248,0.10)' },
      }),
      h('div', {
        key: 'strip',
        className: 'absolute',
        style: { top: 0, left: 32, right: 32, height: 1, borderRadius: 999, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent)' },
      }),
      // brand badge
      h('div', {
        key: 'badge',
        className: 'absolute flex items-center gap-2',
        style: { top: 14, left: '50%', transform: 'translateX(-50%)' },
      }, [
        h('div', {
          key: 'led',
          style: {
            width: 10, height: 10, borderRadius: 999,
            background: powerOn ? '#4ade80' : '#dc2626',
            boxShadow: powerOn ? '0 0 10px #4ade80' : '0 0 6px #dc2626',
          },
        }),
        h('span', {
          key: 't',
          className: 'font-mono font-bold uppercase',
          style: { fontSize: '0.6rem', letterSpacing: '0.5em', color: 'rgba(255,255,255,0.65)' },
        }, 'NOUS'),
      ]),
      // recessed screen bezel
      h('div', {
        key: 'bezel',
        className: 'relative',
        style: {
          marginTop: 22,
          borderRadius: 16,
          background: 'rgba(0,0,0,0.55)',
          padding: 16,
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.06), 0 1px 0 rgba(255,255,255,0.05)',
        },
      }, [
        h('div', {
          key: 'glow',
          className: 'pointer-events-none absolute inset-0',
          style: { borderRadius: 16, boxShadow: powerOn ? 'inset 0 0 40px rgba(74,222,128,0.06)' : 'none' },
        }),
        h('div', {
          key: 'scr',
          className: 'relative overflow-hidden rounded bg-black',
          style: { aspectRatio: '16 / 9' },
        }, [
          h(Screen, { key: 'c', ctx, channel, powerOn }),
          powerOn && h('div', {
            key: 'osd',
            className: 'pointer-events-none absolute',
            style: { bottom: 8, left: 8, zIndex: 20 },
          }, h('div', {
            className: 'flex items-center gap-1.5 rounded border px-2 py-0.5',
            style: { background: 'rgba(0,0,0,0.8)', borderColor: '#475569' },
          }, [
            h('span', { key: 'a', className: 'font-mono', style: { fontSize: '0.45rem', color: '#64748b' } }, 'CH'),
            h('span', { key: 'b', className: 'font-mono text-sm', style: { color: '#4ade80' } }, String(channelIdx + 1).padStart(2, '0')),
          ])),
        ]),
      ]),
      children,
    ]),
  ])
}

// ── Remote / control panel ───────────────────────────────────────────────────

function RemoteButton({ label, icon, title, onClick, tone, wide, disabled }) {
  const tones = {
    power: { bg: 'rgba(52,211,153,0.15)', bc: 'rgba(52,211,153,0.4)', fg: '#6ee7b7' },
    off: { bg: 'rgba(239,68,68,0.10)', bc: 'rgba(239,68,68,0.3)', fg: '#fca5a5' },
    primary: { bg: 'rgba(56,189,248,0.18)', bc: 'rgba(56,189,248,0.45)', fg: '#bae6fd' },
    plain: { bg: 'rgba(255,255,255,0.05)', bc: 'rgba(255,255,255,0.1)', fg: 'rgba(255,255,255,0.6)' },
  }
  const t = tones[tone] || tones.plain
  return h('button', {
    type: 'button',
    title,
    disabled,
    onClick: () => { if (!disabled) { haptic('tap'); onClick() } },
    className: 'inline-flex flex-shrink-0 select-none items-center justify-center gap-2 rounded-xl border font-mono transition-all active:scale-90 hover:brightness-125',
    style: {
      height: wide ? 44 : 40,
      minWidth: wide ? 56 : 40,
      padding: '0 14px',
      fontSize: '0.6rem',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      background: t.bg,
      borderColor: t.bc,
      color: t.fg,
      opacity: disabled ? 0.35 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 6px rgba(0,0,0,0.4)',
    },
  }, icon ? h('span', {
    key: 'i',
    style: { fontSize: '0.85rem', lineHeight: 1 },
  }, icon) : null, label ? h('span', { key: 'l' }, label) : null)
}

function ControlPanel({ channelIdx, powerOn, tvSize, onSize, onPopOut, onCloseFloating, onEditChannels, onPower, onPrev, onNext, onSelect }) {
  const ch = CHANNELS[channelIdx]
  const isFloating = tvState.floating
  return h('div', {
    className: 'mt-3',
    style: { borderRadius: 14, padding: '16px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' } },
  [
    // transport row
    h('div', { key: 'row', className: 'mb-3 flex flex-wrap items-center justify-center gap-2' }, [
      h(RemoteButton, { key: 'p', icon: powerOn ? '⏻' : '⏻', title: 'Power', tone: powerOn ? 'power' : 'off', onClick: onPower }),
      h('div', { key: 'd1', style: { width: 1, height: 28, background: 'rgba(255,255,255,0.1)' } }),
      h(RemoteButton, { key: 'prev', icon: '⏮', title: 'Previous channel', onClick: onPrev, disabled: !powerOn }),
      h(RemoteButton, {
        key: 'ch', icon: '📺', title: ch ? ch.name : 'Channel',
        tone: 'primary', wide: true,
        // live readout of the current channel, not a dead button
        label: powerOn ? String(channelIdx + 1).padStart(2, '0') + ' · ' + (ch ? ch.name : '') : 'off',
        onClick: () => {}, disabled: !powerOn,
      }),
      h(RemoteButton, { key: 'next', icon: '⏭', title: 'Next channel', onClick: onNext, disabled: !powerOn }),
      h(RemoteButton, { key: 'pop', icon: isFloating ? '✕' : '⧉', title: isFloating ? 'Close mini-player' : 'Pop out (watch while you work)', tone: isFloating ? 'off' : 'primary', onClick: isFloating ? onCloseFloating : onPopOut, disabled: !powerOn }),
    ]),
    // bezel size slider + edit channels
    h('div', {
      key: 'size',
      className: 'mt-3 flex items-center gap-2 px-1',
    }, [
      h('span', { key: 'l', className: 'font-mono', style: { fontSize: '0.55rem', letterSpacing: '0.12em', color: 'var(--ui-text-tertiary)', textTransform: 'uppercase' } }, 'bezel'),
      h('input', {
        key: 's',
        type: 'range', min: 280, max: 880, step: 20, value: tvSize,
        onChange: e => onSize(parseInt(e.target.value, 10)),
        className: 'flex-1',
        style: { accentColor: '#38bdf8', height: 4 },
      }),
      h('span', { key: 'v', className: 'font-mono', style: { fontSize: '0.55rem', color: 'var(--ui-text-tertiary)' } }, tvSize + 'px'),
      h('button', {
        key: 'edit', type: 'button', onClick: onEditChannels, title: 'Edit channels',
        className: 'rounded-md px-2 py-1 font-mono transition-colors',
        style: { fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--ui-text-tertiary)', border: '1px solid var(--ui-stroke-secondary)', background: 'rgba(255,255,255,0.03)' },
      }, 'EDIT'),
    ]),
    // channel pills
    h('div', {
      key: 'pills',
      className: 'flex items-center gap-1.5 overflow-x-auto pb-1 mt-3',
      style: { scrollbarWidth: 'none' },
    }, [ activeChannels().map((c, i) =>
      h('button', {
        key: c.id,
        type: 'button',
        title: c.name,
        onClick: () => { haptic('tap'); onSelect(i) },
        className: 'relative flex-shrink-0 select-none rounded-full border font-mono transition-transform active:scale-95',
        style: {
          height: 30,
          padding: '0 11px',
          fontSize: '0.56rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          background: channelIdx === i ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.04)',
          borderColor: channelIdx === i ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.08)',
          color: channelIdx === i ? '#e9d5ff' : 'rgba(255,255,255,0.4)',
          boxShadow: channelIdx === i ? '0 0 14px rgba(56,189,248,0.25), inset 0 1px 0 rgba(255,255,255,0.1)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        },
      }, String(i + 1).padStart(2, '0')) ) ],
    ),
  ])
}

// ── Channel reconfig modal ───────────────────────────────────────────────────
function EditChannels({ onClose }) {
  // local working copy of order + hidden, committed on save
  const [order, setOrder] = React.useState(() => (channelOrder ? channelOrder.slice() : CHANNELS.map(c => c.id)))
  const [hidden, setHidden] = React.useState(() => (channelHidden ? new Set(channelHidden) : new Set()))
  const move = (id, dir) => setOrder(o => {
    const i = o.indexOf(id); if (i < 0) return o
    const j = i + dir; if (j < 0 || j >= o.length) return o
    const n = o.slice(); [n[i], n[j]] = [n[j], n[i]]; return n
  })
  const toggle = id => setHidden(h => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })
  const save = () => {
    channelOrder = order.slice()
    channelHidden = new Set(hidden)
    channelsSave()
    // keep current idx valid
    if (tvState.idx >= activeChannels().length) tvSet({ idx: 0 })
    onClose()
  }
  return h('div', {
    key: 'edit', className: 'fixed inset-0 z-50 flex items-center justify-center',
    style: { background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' },
    onClick: e => { if (e.target === e.currentTarget) onClose() },
  }, h('div', {
    className: 'w-[320px] max-h-[70vh] overflow-auto rounded-xl p-4',
    style: { background: 'rgba(18,18,24,0.98)', border: '1px solid rgba(255,255,255,0.1)' },
  }, [
    h('div', { key: 'h', className: 'mb-3 flex items-center justify-between' }, [
      h('h3', { key: 't', className: 'font-mono uppercase', style: { fontSize: '0.7rem', letterSpacing: '0.16em', color: 'var(--ui-text-primary)' } }, 'Edit Channels'),
      h('button', { key: 'x', type: 'button', onClick: onClose, className: 'rounded p-1', style: { color: 'var(--ui-text-tertiary)' } }, '✕'),
    ]),
    h('div', { key: 'list', className: 'space-y-1.5' }, order.map(id => {
      const c = CHANNELS.find(x => x.id === id); if (!c) return null
      const isHidden = hidden.has(id)
      return h('div', {
        key: id, className: 'flex items-center gap-2 rounded-md px-2 py-1.5',
        style: { background: 'rgba(255,255,255,0.03)', opacity: isHidden ? 0.45 : 1 },
      }, [
        h('span', { key: 'n', className: 'flex-1 truncate', style: { fontSize: '0.75rem', color: 'var(--ui-text-primary)' } }, c.name),
        h('button', { key: 'up', type: 'button', onClick: () => move(id, -1), title: 'Move up', className: 'rounded px-1.5', style: { fontSize: '0.7rem', color: 'var(--ui-text-tertiary)' } }, '↑'),
        h('button', { key: 'dn', type: 'button', onClick: () => move(id, 1), title: 'Move down', className: 'rounded px-1.5', style: { fontSize: '0.7rem', color: 'var(--ui-text-tertiary)' } }, '↓'),
        h('button', { key: 'h', type: 'button', onClick: () => toggle(id), title: isHidden ? 'Show' : 'Hide', className: 'rounded px-2 py-0.5 font-mono', style: { fontSize: '0.5rem', color: isHidden ? '#4ade80' : 'var(--ui-text-tertiary)', border: '1px solid var(--ui-stroke-secondary)' } }, isHidden ? 'HIDDEN' : 'SHOW'),
      ])
    })),
    h('button', { key: 'save', type: 'button', onClick: save, className: 'mt-3 w-full rounded-md py-2 font-mono uppercase', style: { fontSize: '0.6rem', letterSpacing: '0.12em', background: 'rgba(56,189,248,0.18)', color: '#38bdf8' } }, 'Save'),
  ]))
}

function TvGuide({ channelIdx, onSelect }) {
  return h('div', {
    className: 'mt-6 overflow-hidden',
    style: { borderRadius: 14, border: '1px solid var(--ui-stroke-secondary)', background: 'rgba(255,255,255,0.02)' },
  }, [
    h('div', {
      key: 'hd',
      className: 'flex items-center justify-between gap-3 border-b px-4 py-3',
      style: { borderColor: 'var(--ui-stroke-secondary)' },
    }, [
      h('h2', {
        key: 't',
        className: 'font-mono uppercase',
        style: { fontSize: '0.72rem', letterSpacing: '0.18em', color: 'var(--ui-text-secondary)' },
      }, 'TV Guide'),
      h('div', { key: 'dots', className: 'flex flex-shrink-0 gap-1.5' }, activeChannels().map((_, i) =>
        h('div', {
          key: i,
          style: {
            width: 6, height: 20, borderRadius: 999,
            background: channelIdx === i ? '#4ade80' : '#334155',
            boxShadow: channelIdx === i ? '0 0 6px rgba(74,222,128,0.6)' : 'none',
          },
        }),
      )),
    ]),
    h('div', {
      key: 'rows',
      className: 'flex items-center gap-1.5 overflow-x-auto px-3 py-3',
      style: { scrollbarWidth: 'none' },
    }, activeChannels().map((ch, i) =>
      h('button', {
        key: ch.id,
        type: 'button',
        title: ch.name,
        onClick: () => { haptic('tap'); onSelect(i) },
        className: cn(
          'relative flex flex-shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 font-mono transition-transform active:scale-95',
        ),
        style: {
          height: 32,
          fontSize: '0.63rem',
          background: channelIdx === i ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.03)',
          borderColor: channelIdx === i ? 'rgba(56,189,248,0.5)' : 'var(--ui-stroke-secondary)',
          color: channelIdx === i ? 'var(--ui-text-primary)' : 'var(--ui-text-tertiary)',
        },
      }, [
        h('span', { key: 'n', style: { fontWeight: 700 } }, String(i + 1).padStart(2, '0')),
        h('span', { key: 'm', style: { opacity: 0.75 } }, ch.name),
      ]),
    )),
  ])
}

// ── NousBoy games console ────────────────────────────────────────────────────

function GamesConsole({ ctx }) {
  const [activeId, setActiveId] = React.useState('g1')
  const [on, setOn] = React.useState(false)
  const game = GAMES.find(g => g.id === activeId) || GAMES[0]
  const asset = useHtmlAsset(ctx, on && game.file ? `/asset/game/${game.file}` : null)

  const body = !on
    ? h('div', {
        className: 'absolute inset-0 flex items-center justify-center font-mono',
        style: { background: '#0d1210', fontSize: '0.6rem', letterSpacing: '0.4em', color: 'rgba(158,255,190,0.25)' },
      }, 'press start')
    : game.src
      ? h('iframe', { src: game.src, title: game.name, className: 'absolute inset-0 h-full w-full border-0' })
      : asset.loading
        ? h('div', { className: 'absolute inset-0 flex items-center justify-center' }, h(GlyphSpinner, {}))
        : asset.error
          ? h('div', {
              className: 'absolute inset-0 flex items-center justify-center font-mono',
              style: { fontSize: '0.6rem', color: '#fca5a5' },
            }, 'cartridge error')
          : h('iframe', { src: asset.url, title: game.name, className: 'absolute inset-0 h-full w-full border-0' })

  return h('div', { className: 'mx-auto mt-8 w-full', style: { maxWidth: 620 } }, [
    h('div', {
      key: 'shell',
      className: 'relative',
      style: {
        borderRadius: 24,
        background: 'rgba(14,16,20,0.75)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)',
        padding: '16px',
      },
    }, [
      h('div', {
        key: 'hd',
        className: 'mb-3 flex items-center justify-between',
      }, [
        h('span', {
          key: 't',
          className: 'font-mono font-bold uppercase',
          style: { fontSize: '0.6rem', letterSpacing: '0.4em', color: 'rgba(255,255,255,0.6)' },
        }, 'NousBoy'),
        h(RemoteButton, { key: 'p', label: on ? 'on' : 'off', title: 'Power', tone: on ? 'power' : 'off', onClick: () => setOn(v => !v) }),
      ]),
      // screen housing — dark olive bezel
      h('div', {
        key: 'bez',
        className: 'relative',
        style: {
          borderRadius: 14,
          background: '#20261f',
          padding: 14,
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.05)',
        },
      }, h('div', {
        className: 'relative overflow-hidden rounded bg-black',
        style: { aspectRatio: '4 / 3' },
      }, body)),
      // cartridge selector
      h('div', {
        key: 'carts',
        className: 'mt-3 flex flex-wrap items-center justify-center gap-1.5',
      }, GAMES.map(g =>
        h('button', {
          key: g.id,
          type: 'button',
          title: g.name,
          onClick: () => { haptic('tap'); setActiveId(g.id) },
          className: 'flex-shrink-0 select-none rounded-full border px-3 font-mono transition-transform active:scale-95',
          style: {
            height: 30,
            fontSize: '0.6rem',
            background: activeId === g.id ? 'rgba(74,222,128,0.16)' : 'rgba(255,255,255,0.04)',
            borderColor: activeId === g.id ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.08)',
            color: activeId === g.id ? '#bbf7d0' : 'rgba(255,255,255,0.4)',
          },
        }, g.name),
      )),
      h('div', {
        key: 'hint',
        className: 'mt-2 text-center font-mono',
        style: { fontSize: '0.55rem', color: 'var(--ui-text-tertiary)' },
      }, 'click the screen first, then use arrows / WASD / space'),
    ]),
  ])
}

// ── TV & Games tab ───────────────────────────────────────────────────────────

function TvView({ ctx }) {
  // Use the shared TV store so the floating mini-player stays in sync.
  const tv = tvUse()
  const channels = activeChannels()
  const idx = tv.idx
  const powerOn = tv.powerOn
  const tvSize = tv.size
  const channel = channels[idx] || channels[0]
  const select = i => tvSetPersist({ idx: ((i % channels.length) + channels.length) % channels.length })
  // Keyboard shortcuts: arrows = channel, space = power, P = pop-out.
  useTvKeys(popOut)

  // Pop the TV out as a floating, draggable card above the workspace. The shell
  // owns drag + position persistence. We capture the disposer so the X button
  // can unregister (close) it. Guard against double-register.
  const popOut = React.useCallback(() => {
    if (tvState.floating) return
    try {
      const dispose = ctx.register({
        id: 'floating-tv',
        area: 'panes',
        title: 'TV',
        data: { placement: 'floating', anchor: 'bottom-right', width: String(tvState.size) + 'px', height: 'auto' },
        render: () => h(FloatingTv, { ctx }),
      })
      floatingDispose = dispose
      tvSet({ floating: true })
      haptic('tap')
    } catch { /* already registered */ }
  }, [])

  const closeFloating = React.useCallback(() => {
    try { floatingDispose && floatingDispose() } catch { /* ignore */ }
    floatingDispose = null
    tvSet({ floating: false })
  }, [])

  const [editing, setEditing] = React.useState(false)

  return h(ScrollArea, { className: 'h-full' },
    h('div', { className: 'px-6 py-6' }, [
      h('h1', {
        key: 'h1',
        className: 'mb-6 font-bold uppercase',
        style: { fontSize: '1.35rem', letterSpacing: '0.2em', color: 'var(--ui-text-primary)' } },
        'Entertainment'),
      h(TvCabinet, {
        key: 'tv',
        ctx,
        channel,
        channelIdx: idx,
        powerOn,
        size: tvSize,
        onPower: () => tvSetPersist({ powerOn: !tvState.powerOn }),
      }, h(ControlPanel, {
        key: 'ctrl',
        channelIdx: idx,
        powerOn,
        tvSize,
        onSize: v => tvSetPersist({ size: v }),
        onPopOut: popOut,
        onCloseFloating: closeFloating,
        onEditChannels: () => setEditing(true),
        onPower: () => tvSetPersist({ powerOn: !tvState.powerOn }),
        onPrev: () => select(idx - 1),
        onNext: () => select(idx + 1),
        onSelect: select,
      })),
      h('div', { key: 'g', className: 'mx-auto w-full', style: { maxWidth: tvSize } },
        h(TvGuide, { channelIdx: idx, onSelect: select })),
      h(GamesConsole, { key: 'gb', ctx }),
      editing ? h(EditChannels, { key: 'edit', onClose: () => setEditing(false) }) : null,
    ]),
  )
}

// Floating mini-player — a draggable card above the workspace. Reads the shared
// TV store so it mirrors the main pane's channel/power. Has its own X to close.
function FloatingTv({ ctx }) {
  const tv = tvUse()
  const channels = activeChannels()
  const idx = tv.idx
  const powerOn = tv.powerOn
  const ch = channels[idx] || channels[0]
  const gameMode = tv.floatingMode === 'game'
  const select = i => tvSet({ idx: ((i % channels.length) + channels.length) % channels.length })
  // Show the current Spotify track in the mini-player header while you code.
  const nowQ = useQuery({
    queryKey: [ID, 'floating', 'spotify', 'now'],
    queryFn: () => ctx.rest('/spotify/now-playing'),
    retry: false,
    refetchInterval: 10000,
  })
  const nowData = nowQ.data || {}
  const nowTrack = nowData.track || nowData.item || null
  const nowArtists = nowTrack ? (Array.isArray(nowTrack.artists) ? nowTrack.artists.map(a => (typeof a === 'string' ? a : a.name)) : []) : []
  const close = () => {
    try { floatingDispose && floatingDispose() } catch { /* ignore */ }
    floatingDispose = null
    tvSet({ floating: false })
  }
  const toggleMode = () => tvSet({ floatingMode: gameMode ? 'tv' : 'game' })

  return h('div', {
    className: 'flex h-full flex-col',
    style: { background: 'rgba(8,8,12,0.98)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' },
  }, [
    // custom close bar — the shell header above is the drag handle; we only
    // need an X to dismiss (the shell has no close, only a collapse chevron).
    h('div', {
      key: 'hdr',
      className: 'flex items-center justify-between gap-2 px-2 py-1',
      style: { borderBottom: '1px solid rgba(255,255,255,0.06)' },
    }, [
      h('div', { key: 'np', className: 'min-w-0 flex-1 truncate', style: { fontSize: '0.58rem', color: 'var(--ui-text-tertiary)', letterSpacing: '0.04em' } },
        nowTrack ? '♪ ' + nowTrack.name + (nowArtists.length ? ' — ' + nowArtists.join(', ') : '') : (gameMode ? 'GAME' : 'TV · ' + ch.name)),
      h('button', {
        key: 'mode', type: 'button', onClick: toggleMode, title: gameMode ? 'Switch to TV' : 'Switch to Game',
        className: 'rounded p-1 transition-colors',
        style: { color: 'var(--ui-text-tertiary)', fontSize: '0.65rem' },
        onPointerDown: e => e.stopPropagation(),
      }, gameMode ? '📺' : '🎮'),
      h('button', {
        key: 'x', type: 'button', onClick: close, title: 'Close mini-player',
        className: 'rounded p-1 transition-colors',
        style: { color: 'var(--ui-text-quaternary)', fontSize: '0.7rem' },
        onPointerDown: e => e.stopPropagation(),
      }, '✕'),
    ]),
    gameMode
      ? h(GamesConsole, { key: 'game', ctx })
      : h(TvCabinet, {
        key: 'cab',
        ctx, channel: ch, channelIdx: idx, powerOn,
        size: tv.size,
        onPower: () => tvSet({ powerOn: !tvState.powerOn }),
      }, h('div', { key: 'ctl', className: 'px-3 pb-3' }, [
      h('div', { className: 'flex items-center justify-center gap-2' }, [
        h(RemoteButton, { key: 'p', icon: '⏻', title: 'Power', tone: powerOn ? 'power' : 'off', onClick: () => tvSet({ powerOn: !tvState.powerOn }) }),
        h(RemoteButton, { key: 'prev', icon: '⏮', title: 'Prev', onClick: () => select(idx - 1), disabled: !powerOn }),
        h(RemoteButton, { key: 'ch', icon: '📺', title: ch.name, tone: 'primary', wide: true, label: powerOn ? String(idx + 1).padStart(2, '0') : 'off', onClick: () => {}, disabled: !powerOn }),
        h(RemoteButton, { key: 'next', icon: '⏭', title: 'Next', onClick: () => select(idx + 1), disabled: !powerOn }),
      ]),
      // channel pills inside the mini-player for quick switching
      h('div', { key: 'pills', className: 'mt-2 flex flex-wrap items-center gap-1 overflow-x-auto', style: { scrollbarWidth: 'none' } },
        channels.map((c, i) => h('button', {
          key: c.id, type: 'button', title: c.name, onClick: () => select(i),
          className: 'flex-shrink-0 rounded-full border font-mono transition-transform active:scale-95',
          style: {
            height: 24, padding: '0 8px', fontSize: '0.5rem', fontWeight: 700,
            background: idx === i ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.04)',
            borderColor: idx === i ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.08)',
            color: idx === i ? '#e9d5ff' : 'rgba(255,255,255,0.4)',
          },
        }, String(i + 1).padStart(2, '0')))),
    ])),
  ])
}

// ── Discord ──────────────────────────────────────────────────────────────────

function DiscordView({ ctx }) {
  const [guildId, setGuildId] = React.useState(null)
  const [channelId, setChannelId] = React.useState(null)
  const [draft, setDraft] = React.useState('')

  const guildsQ = useQuery({
    queryKey: [ID, 'discord', 'guilds'],
    queryFn: () => ctx.rest('/discord/guilds'),
    retry: false,
  })
  const channelsQ = useQuery({
    queryKey: [ID, 'discord', 'channels', guildId],
    queryFn: () => ctx.rest(`/discord/channels?guild_id=${guildId}`),
    enabled: !!guildId,
    retry: false,
  })
  const msgsQ = useQuery({
    queryKey: [ID, 'discord', 'messages', channelId],
    queryFn: () => ctx.rest(`/discord/messages?channel_id=${channelId}&limit=40`),
    enabled: !!channelId,
    retry: false,
    refetchInterval: 15000,
  })

  if (guildsQ.isLoading) {
    return h('div', { className: 'flex h-full items-center justify-center' }, h(GlyphSpinner, {}))
  }
  if (guildsQ.error) {
    return h(ErrorState, {
      title: 'Discord unavailable',
      message: 'Add DISCORD_BOT_TOKEN to ~/.hermes/.env, give the bot Read Message History + Send Messages, then restart the dashboard.',
      onRetry: guildsQ.refetch,
    })
  }

  const list = guildsQ.data
  const guilds = Array.isArray(list) ? list : (list && list.guilds) || []
  const channels = Array.isArray(channelsQ.data) ? channelsQ.data : (channelsQ.data && channelsQ.data.channels) || []
  const messages = Array.isArray(msgsQ.data) ? msgsQ.data : (msgsQ.data && msgsQ.data.messages) || []

  const send = () => {
    const content = draft.trim()
    if (!content || !channelId) return
    setDraft('')
    ctx.rest('/discord/send', { method: 'POST', body: { channel_id: channelId, content } })
      .then(() => msgsQ.refetch())
      .catch(() => host.notifyError(new Error('Could not send message'), 'Discord'))
  }

  const pill = (active, label, onClick, key) => h('button', {
    key,
    type: 'button',
    onClick: () => { haptic('tap'); onClick() },
    className: 'flex-shrink-0 select-none rounded-full border px-3 py-1 transition-transform active:scale-95',
    style: {
      fontSize: '0.68rem',
      background: active ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
      borderColor: active ? 'rgba(56,189,248,0.5)' : 'var(--ui-stroke-secondary)',
      color: active ? 'var(--ui-text-primary)' : 'var(--ui-text-tertiary)',
    },
  }, label)

  return h('div', { className: 'flex h-full flex-col' }, [
    h('div', {
      key: 'hd',
      className: 'border-b px-5 py-3 font-mono uppercase',
      style: { borderColor: 'var(--ui-stroke-secondary)', fontSize: '0.72rem', letterSpacing: '0.18em', color: 'var(--ui-text-secondary)' },
    }, 'Discord'),
    h('div', { key: 'sel', className: 'space-y-2 px-5 py-3' }, [
      h('div', { key: 'gl', className: 'flex flex-wrap gap-1.5' },
        guilds.map(g => pill(g.id === guildId, g.name, () => { setGuildId(g.id); setChannelId(null) }, g.id))),
      guildId && channels.length
        ? h('div', { key: 'cl', className: 'flex flex-wrap gap-1.5' },
            channels.map(c => pill(c.id === channelId, '#' + c.name, () => setChannelId(c.id), c.id)))
        : null,
    ]),
    h(ScrollArea, { key: 'msgs', className: 'flex-1' },
      h('div', { className: 'space-y-2 px-5 pb-4' },
        !channelId
          ? h(EmptyState, { title: 'Pick a channel', message: 'Choose a server, then a channel to read messages.' })
          : msgsQ.isLoading
            ? h('div', { className: 'flex justify-center py-6' }, h(GlyphSpinner, {}))
            : messages.slice().reverse().map(m =>
                h('div', { key: m.id, style: { fontSize: '0.75rem', lineHeight: 1.6 } }, [
                  h('span', { key: 'a', style: { fontWeight: 600, color: 'var(--ui-text-secondary)' } },
                    ((m.author && m.author.username) || 'unknown') + ': '),
                  h('span', { key: 'b', style: { color: 'var(--ui-text-primary)' } }, m.content || ''),
                ]),
              ),
      )),
    channelId ? h('div', {
      key: 'composer',
      className: 'flex items-center gap-2 border-t px-5 py-3',
      style: { borderColor: 'var(--ui-stroke-secondary)' },
    }, [
      h('input', {
        key: 'i',
        value: draft,
        placeholder: 'Message…',
        onChange: e => setDraft(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } },
        className: 'flex-1 rounded-md border bg-transparent px-3 py-2 outline-none',
        style: { fontSize: '0.78rem', borderColor: 'var(--ui-stroke-secondary)', color: 'var(--ui-text-primary)' },
      }),
      h(RemoteButton, { key: 's', label: 'send', title: 'Send', tone: 'primary', onClick: send }),
    ]) : null,
  ])
}

// ── Gallery ──────────────────────────────────────────────────────────────────

function GalleryTile({ ctx, file, onOpen }) {
  const [url, setUrl] = React.useState(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let live = true
    // ?w=400 — thumbnails only. The full set is ~63 MB base64; pushing that
    // through the IPC bridge for a grid would stall the pane.
    fetchAsset(ctx, `/asset/gallery/${encodeURIComponent(file)}?w=400`)
      .then(u => live && setUrl(u))
      .catch(() => live && setFailed(true))
    return () => { live = false }
  }, [ctx, file])

  return h('button', {
    type: 'button',
    title: file,
    onClick: () => onOpen({ file }),
    className: 'overflow-hidden rounded-lg border transition-transform active:scale-95',
    style: { borderColor: 'var(--ui-stroke-secondary)', background: 'rgba(0,0,0,0.4)' },
  }, url
    ? h('img', { src: url, alt: file, loading: 'lazy', className: 'h-40 w-full object-cover' })
    : h('div', {
        className: 'flex h-40 items-center justify-center font-mono',
        style: { fontSize: '0.55rem', color: 'var(--ui-text-tertiary)' },
      }, failed ? 'failed' : h(GlyphSpinner, {})))
}

/** Full-resolution view; fetched only when a tile is opened. */
function Lightbox({ ctx, file, onClose }) {
  const [url, setUrl] = React.useState(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let live = true
    setUrl(null)
    setFailed(false)
    fetchAsset(ctx, `/asset/gallery/${encodeURIComponent(file)}`)
      .then(u => live && setUrl(u))
      .catch(() => live && setFailed(true))
    return () => { live = false }
  }, [ctx, file])

  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return h('div', {
    onClick: onClose,
    className: 'absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 p-8',
    style: { background: 'rgba(0,0,0,0.88)', cursor: 'zoom-out' },
  }, [
    failed
      ? h('div', { key: 'e', className: 'font-mono', style: { fontSize: '0.7rem', color: '#fca5a5' } }, 'could not load image')
      : url
        ? h('img', { key: 'i', src: url, alt: file, style: { maxWidth: '100%', maxHeight: '82%', objectFit: 'contain', borderRadius: 8 } })
        : h(GlyphSpinner, { key: 's' }),
    h('div', { key: 'c', className: 'font-mono', style: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)' } }, file),
  ])
}

function GalleryView({ ctx }) {
  const [lightbox, setLightbox] = React.useState(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [ID, 'gallery-list'],
    queryFn: () => ctx.rest('/gallery-list'),
    retry: false,
  })

  if (isLoading) return h('div', { className: 'flex h-full items-center justify-center' }, h(GlyphSpinner, {}))
  if (error) return h(ErrorState, { title: 'Gallery unavailable', message: 'The Entertainment backend is not reachable.', onRetry: refetch })

  const imgs = (data && data.images) || []
  if (!imgs.length) return h(EmptyState, { title: 'No gallery images', message: 'Add images to dashboard/public/gallery/' })

  return h('div', { className: 'relative flex h-full flex-col' }, [
    h('div', {
      key: 'hd',
      className: 'border-b px-5 py-3 font-mono uppercase',
      style: { borderColor: 'var(--ui-stroke-secondary)', fontSize: '0.72rem', letterSpacing: '0.18em', color: 'var(--ui-text-secondary)' },
    }, `Gallery · ${imgs.length}`),
    h(ScrollArea, { key: 'grid', className: 'flex-1' },
      h('div', {
        className: 'grid gap-3 p-5',
        style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' },
      }, imgs.map(f => h(GalleryTile, { key: f, ctx, file: f, onOpen: setLightbox })))),
    lightbox ? h(Lightbox, { key: 'lb', ctx, file: lightbox.file, onClose: () => setLightbox(null) }) : null,
  ])
}

// ── Music (multi-provider: Spotify + Apple Music) ─────────────────────────────

function MusicView({ ctx }) {
  const [provider, setProvider] = React.useState('spotify')

  // Spotify
  const spotNow = useQuery({
    queryKey: [ID, 'spotify', 'now'],
    queryFn: () => ctx.rest('/spotify/now-playing'),
    retry: false,
    refetchInterval: provider === 'spotify' ? 10000 : false,
  })
  const spotRecent = useQuery({
    queryKey: [ID, 'spotify', 'recent'],
    queryFn: () => ctx.rest('/spotify/recently-played'),
    retry: false,
  })

  // Apple Music
  const appleStatus = useQuery({
    queryKey: [ID, 'apple', 'status'],
    queryFn: () => ctx.rest('/apple/status'),
    retry: false,
    enabled: provider === 'apple',
  })
  const appleRecent = useQuery({
    queryKey: [ID, 'apple', 'recent'],
    queryFn: () => ctx.rest('/apple/recently-played'),
    retry: false,
    enabled: provider === 'apple',
  })

  const ProviderTabs = h('div', {
    key: 'prov',
    className: 'mb-6 flex items-center gap-1 rounded-lg p-1',
    style: { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ui-stroke-secondary)' },
  }, [
    h('button', {
      key: 'sp', type: 'button', onClick: () => setProvider('spotify'),
      className: 'flex-1 rounded-md px-3 py-1.5 font-mono uppercase transition-colors',
      style: { fontSize: '0.62rem', letterSpacing: '0.12em', background: provider === 'spotify' ? 'rgba(29,185,84,0.18)' : 'transparent', color: provider === 'spotify' ? '#1db954' : 'var(--ui-text-tertiary)' },
    }, 'Spotify'),
    h('button', {
      key: 'ap', type: 'button', onClick: () => setProvider('apple'),
      className: 'flex-1 rounded-md px-3 py-1.5 font-mono uppercase transition-colors',
      style: { fontSize: '0.62rem', letterSpacing: '0.12em', background: provider === 'apple' ? 'rgba(253,53,80,0.18)' : 'transparent', color: provider === 'apple' ? '#fb3b5c' : 'var(--ui-text-tertiary)' },
    }, 'Apple Music'),
  ])

  if (provider === 'apple') {
    if (appleStatus.isLoading) return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [ProviderTabs, h('div', { className: 'flex h-40 items-center justify-center' }, h(GlyphSpinner, {}))]))
    if (appleStatus.data && !appleStatus.data.connected) {
      return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [
        ProviderTabs,
        h(ErrorState, {
          title: 'Apple Music not connected',
          message: 'Set APPLE_MUSIC_DEVELOPER_TOKEN in the dashboard env to show your recently played. Tap a track to open it in the Music app.',
          onRetry: appleStatus.refetch,
        }),
      ]))
    }
    const recent = (appleRecent.data) || []
    return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [
      ProviderTabs,
      h('div', { key: 'hd', className: 'mb-4 font-mono uppercase', style: { fontSize: '0.72rem', letterSpacing: '0.18em', color: 'var(--ui-text-secondary)' } }, 'Apple Music · Recently Played'),
      recent.length ? h('div', { key: 'rl', className: 'space-y-1.5' }, recent.slice(0, 20).map((t, i) =>
        h('button', {
          key: (t.id || '') + i, type: 'button', onClick: () => { if (t.url) window.open(t.url, '_blank'); },
          className: 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
          style: { background: 'rgba(255,255,255,0.03)' },
        }, [
          h('div', { key: 'art', className: 'h-10 w-10 flex-shrink-0 overflow-hidden rounded', style: { background: 'rgba(0,0,0,0.4)' } },
            t.image ? h('img', { src: t.image, alt: '', className: 'h-full w-full object-cover' }) : null),
          h('div', { key: 'meta', className: 'min-w-0' }, [
            h('div', { key: 'n', style: { fontSize: '0.8rem', color: 'var(--ui-text-primary)' }, className: 'truncate' }, t.name || 'unknown'),
            h('div', { key: 'a', style: { fontSize: '0.7rem', color: 'var(--ui-text-tertiary)' }, className: 'truncate' }, (t.artists || []).join(', ')),
          ]),
        ]),
      )) : h('div', { key: 'empty', className: 'font-mono', style: { fontSize: '0.65rem', letterSpacing: '0.1em', color: 'var(--ui-text-tertiary)' } }, 'No recently played yet — tap a song in the Music app, then reload.'),
    ]))
  }

  // Spotify (default)
  if (spotNow.isLoading) return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [ProviderTabs, h('div', { className: 'flex h-40 items-center justify-center' }, h(GlyphSpinner, {}))]))
  if (spotNow.error) {
    return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [
      ProviderTabs,
      h(ErrorState, { title: 'Spotify not connected', message: 'Run `hermes auth spotify`, then retry.', onRetry: spotNow.refetch }),
    ]))
  }

  const data = spotNow.data || {}
  const track = data.track || data.item || null
  const playing = !!data.playing
  const artists = track ? (Array.isArray(track.artists) ? track.artists.map(a => (typeof a === 'string' ? a : a.name)) : []) : []
  const cover = track && (track.image || track.album_art || (track.album && track.album.image)) || null
  const recent = (spotRecent.data && (spotRecent.data.items || spotRecent.data.tracks)) || []

  const fire = path => () => {
    haptic('tap')
    ctx.rest(path, { method: 'POST' })
      .then(() => spotNow.refetch())
      .catch(() => host.notifyError(new Error('Spotify action failed'), 'Music'))
  }

  return h(ScrollArea, { className: 'h-full' }, h('div', { className: 'px-6 py-6' }, [
    ProviderTabs,
    h('div', { key: 'hd', className: 'mb-6 font-mono uppercase', style: { fontSize: '0.72rem', letterSpacing: '0.18em', color: 'var(--ui-text-secondary)' } }, 'Mixtape'),
    h('div', { key: 'np', className: 'flex flex-col items-center gap-4' }, [
      h('div', { key: 'art', className: 'overflow-hidden rounded-xl border', style: { width: 220, height: 220, borderColor: 'var(--ui-stroke-secondary)', background: 'rgba(0,0,0,0.4)' } },
        cover ? h('img', { src: cover, alt: 'cover', className: 'h-full w-full object-cover' })
          : h('div', { className: 'flex h-full w-full items-center justify-center font-mono', style: { fontSize: '0.6rem', letterSpacing: '0.3em', color: 'var(--ui-text-tertiary)' } }, 'NO ART')),
      h('div', { key: 'meta', className: 'text-center' }, [
        h('div', { key: 'n', style: { fontSize: '0.95rem', fontWeight: 600, color: 'var(--ui-text-primary)' } }, track ? track.name : 'Nothing playing'),
        h('div', { key: 'a', style: { fontSize: '0.75rem', color: 'var(--ui-text-tertiary)' } }, artists.length ? artists.join(', ') : '—'),
      ]),
      h('div', { key: 'ctl', className: 'flex items-center gap-2' }, [
        h(RemoteButton, { key: 'p', label: '◀◀', title: 'Previous', onClick: fire('/spotify/previous') }),
        h(RemoteButton, { key: 'x', label: playing ? 'pause' : 'play', title: 'Play/Pause', tone: 'primary', wide: true, onClick: fire(playing ? '/spotify/pause' : '/spotify/play') }),
        h(RemoteButton, { key: 'n', label: '▶▶', title: 'Next', onClick: fire('/spotify/next') }),
      ]),
    ]),
    recent.length ? h('div', { key: 'recent', className: 'mt-8' }, [
      h('div', { key: 'rh', className: 'mb-3 font-mono uppercase', style: { fontSize: '0.62rem', letterSpacing: '0.3em', color: 'var(--ui-text-tertiary)' } }, 'B-side · recently played'),
      h('div', { key: 'rl', className: 'space-y-1.5' }, recent.slice(0, 12).map((it, i) => {
        const t = it.track || it
        const as = Array.isArray(t.artists) ? t.artists.map(a => (typeof a === 'string' ? a : a.name)) : []
        const uri = t.uri || (t.external_urls && t.external_urls.spotify)
        return h('button', {
          key: (t.id || '') + i, type: 'button',
          onClick: () => { if (t.external_urls && t.external_urls.spotify) window.open(t.external_urls.spotify, '_blank'); else if (uri) ctx.rest('/spotify/play', { method: 'POST', body: JSON.stringify({ uri }) }).catch(() => {}) },
          className: 'flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-white/5',
          style: { background: 'rgba(255,255,255,0.03)' },
        }, [
          h('span', { key: 'i', className: 'font-mono', style: { fontSize: '0.6rem', color: 'var(--ui-text-tertiary)' } }, String(i + 1).padStart(2, '0')),
          h('span', { key: 'n', style: { fontSize: '0.78rem', color: 'var(--ui-text-primary)' } }, t.name || 'unknown'),
          h('span', { key: 'a', style: { fontSize: '0.7rem', color: 'var(--ui-text-tertiary)' } }, as.join(', ')),
        ])
      })),
    ]) : null,
  ]))
}

// ── Shell ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'tv', label: 'TV & Games', render: (ctx) => h(TvView, { ctx }) },
  { id: 'discord', label: 'Discord', render: (ctx) => h(DiscordView, { ctx }) },
  { id: 'gallery', label: 'Gallery', render: (ctx) => h(GalleryView, { ctx }) },
  { id: 'music', label: 'Music', render: (ctx) => h(MusicView, { ctx }) },
]

function EntertainmentPane({ ctx }) {
  const [tab, setTab] = React.useState('tv')
  const active = TABS.find(t => t.id === tab) || TABS[0]

  return h('div', { className: 'flex h-full flex-col' }, [
    h('div', {
      key: 'tabs',
      className: 'flex flex-shrink-0 items-center gap-1 border-b px-3 py-2',
      style: { borderColor: 'var(--ui-stroke-secondary)' },
    }, TABS.map(t =>
      h('button', {
        key: t.id,
        type: 'button',
        onClick: () => { haptic('tap'); setTab(t.id) },
        className: 'select-none rounded-md px-3 py-1.5 font-mono uppercase transition-colors',
        style: {
          fontSize: '0.65rem',
          letterSpacing: '0.12em',
          background: tab === t.id ? 'rgba(56,189,248,0.16)' : 'transparent',
          color: tab === t.id ? 'var(--ui-text-primary)' : 'var(--ui-text-tertiary)',
        },
      }, t.label),
    )),
    h('div', { key: 'body', className: 'min-h-0 flex-1 overflow-hidden' }, active.render(ctx)),
  ])
}

export default {
  // MUST equal the dashboard manifest name — ctx.rest is scoped to
  // /api/plugins/<id>/ and the backend mounts under this exact string.
  id: ID,
  name: 'Entertainment Pack',
  register(ctx) {
    // Capture storage so TV prefs persist across reloads.
    PLUGIN_STORAGE = ctx.storage
    tvLoad()
    channelsLoad()
    // Inject the TV cross-fade keyframes once.
    if (typeof document !== 'undefined' && !document.getElementById('hermes-tv-fade')) {
      const s = document.createElement('style')
      s.id = 'hermes-tv-fade'
      s.textContent = '@keyframes hermesTvFade{from{opacity:0}to{opacity:1}}'
      document.head.appendChild(s)
    }
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Entertainment',
      // Full-width main pane, not the 340px sidebar strip.
      data: { placement: 'main' },
      render: () => h(EntertainmentPane, { ctx }),
    })
  },
}






