import { MODULE_ID, getClientId } from "./settings.mjs";
import { SpotifyAuthError, isConnected } from "./auth.mjs";
import * as spotify from "./spotify-api.mjs";
import SpotifyApp from "./apps/spotify-app.mjs";

const REPEAT_CYCLE = {off: "context", context: "track", track: "off"};

/**
 * Run a player command for the macro or window that asked for it. Non-GMs, missing setup
 * and Spotify errors all end in a notification; nothing throws to the caller.
 * @param {() => Promise<*>} fn
 */
async function command(fn) {
  if ( !game.user.isGM ) {
    ui.notifications.warn("MANCER_SPOTIFY.Errors.GMOnly", {localize: true});
    return;
  }
  if ( !getClientId() || !isConnected() ) {
    ui.notifications.warn("MANCER_SPOTIFY.Errors.NotConnected", {localize: true});
    openWindow();
    return;
  }
  try {
    const result = await fn();
    foundry.applications.instances.get("mancer-spotify")?.refreshPlayback();
    return result;
  } catch(err) {
    notifyError(err);
  }
}

export function notifyError(err) {
  if ( err instanceof SpotifyAuthError ) ui.notifications.error(err.message);
  else if ( err.reason === "NO_ACTIVE_DEVICE" ) {
    ui.notifications.warn("MANCER_SPOTIFY.Errors.NoActiveDevice", {localize: true});
  }
  else if ( err.reason === "PREMIUM_REQUIRED" ) {
    ui.notifications.error("MANCER_SPOTIFY.Errors.PremiumRequired", {localize: true});
  }
  else ui.notifications.error(_loc("MANCER_SPOTIFY.Errors.Api", {error: err.message}));
  console.error("mancer_spotify |", err);
}

export function openWindow() {
  if ( !game.user.isGM ) {
    ui.notifications.warn("MANCER_SPOTIFY.Errors.GMOnly", {localize: true});
    return;
  }
  const app = foundry.applications.instances.get("mancer-spotify") ?? new SpotifyApp();
  return app.render({force: true});
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

export const api = {
  openWindow,

  /** @param {string} uri  A playlist URI, e.g. "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" */
  playPlaylist: uri => command(() => spotify.play({contextUri: uri})),

  /** Play a song inside a playlist, continuing with the rest of the playlist after it. */
  playTrack: (playlistUri, trackUri) => command(() => {
    return spotify.play({contextUri: playlistUri, offsetUri: trackUri});
  }),

  play: () => command(() => spotify.play()),

  pause: () => command(() => spotify.pause()),

  /** Spotify has no stop; stopping pauses. */
  stop: () => command(() => spotify.pause()),

  playPause: () => command(async () => {
    const state = await spotify.getPlaybackState();
    return state?.is_playing ? spotify.pause() : spotify.play();
  }),

  next: () => command(() => spotify.next()),

  previous: () => command(() => spotify.previous()),

  toggleShuffle: () => command(async () => {
    const state = await spotify.getPlaybackState();
    if ( !state ) throw new spotify.SpotifyError("", {reason: "NO_ACTIVE_DEVICE"});
    return spotify.setShuffle(!state.shuffle_state);
  }),

  cycleRepeat: () => command(async () => {
    const state = await spotify.getPlaybackState();
    if ( !state ) throw new spotify.SpotifyError("", {reason: "NO_ACTIVE_DEVICE"});
    return spotify.setRepeat(REPEAT_CYCLE[state.repeat_state] ?? "off");
  })
};

/**
 * The player actions that can be put on the hotbar, keyed by their api method.
 * `icon` is the window's Font Awesome icon, `img` the macro image.
 * @type {Record<string, {label: string, icon: string, img: string}>}
 */
export const ACTIONS = {
  previous: {label: "MANCER_SPOTIFY.Actions.Previous", icon: "fa-solid fa-backward-step", img: "previous"},
  playPause: {label: "MANCER_SPOTIFY.Actions.PlayPause", icon: "fa-solid fa-play", img: "play-pause"},
  next: {label: "MANCER_SPOTIFY.Actions.Next", icon: "fa-solid fa-forward-step", img: "next"},
  stop: {label: "MANCER_SPOTIFY.Actions.Stop", icon: "fa-solid fa-stop", img: "stop"},
  toggleShuffle: {label: "MANCER_SPOTIFY.Actions.Shuffle", icon: "fa-solid fa-shuffle", img: "shuffle"},
  cycleRepeat: {label: "MANCER_SPOTIFY.Actions.Repeat", icon: "fa-solid fa-repeat", img: "repeat"}
};

/** @param {string} name  An icon file name in this module's icons/ folder, without extension */
export function iconPath(name) {
  return `modules/${MODULE_ID}/icons/${name}.svg`;
}
