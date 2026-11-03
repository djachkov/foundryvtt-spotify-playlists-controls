import { MODULE_ID, getClientId, getTokens, setTokens } from "./settings.mjs";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing"
];

/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

/** The PKCE verifier and state of the login in progress, kept in memory only. */
let pending = null;

/** Interval that watches the login popup for its return to this origin. */
let popupWatch = null;

/** Shared in-flight refresh so concurrent API calls refresh only once. */
let refreshing = null;

export class SpotifyAuthError extends Error {}

/* -------------------------------------------- */
/*  Redirect URI                                */
/* -------------------------------------------- */

/**
 * Problems Spotify will have with this Foundry's own URL as a redirect URI.
 * Spotify accepts only HTTPS or a loopback IP literal, and rejects "localhost".
 * @returns {"localhost"|"insecure"|null}
 */
export function redirectUriProblem() {
  const {protocol, hostname} = window.location;
  if ( hostname === "localhost" ) return "localhost";
  const loopback = (hostname === "127.0.0.1") || (hostname === "[::1]");
  if ( (protocol !== "https:") && !loopback ) return "insecure";
  return null;
}

/**
 * The callback page shipped with this module. Served by this Foundry when Spotify accepts
 * its URL; otherwise the same path on 127.0.0.1, which the user copies back by hand.
 * Foundry serves module HTML as plain text, so the page is a .txt that runs no script;
 * the opener reads the code from the popup's URL instead (see {@link login}).
 */
export function redirectUri() {
  const path = foundry.utils.getRoute(`modules/${MODULE_ID}/callback.txt`);
  if ( !redirectUriProblem() ) return window.location.origin + path;
  const port = window.location.port ? `:${window.location.port}` : "";
  return `http://127.0.0.1${port}${path}`;
}

/* -------------------------------------------- */
/*  Login                                       */
/* -------------------------------------------- */

export function isConnected() {
  return !!getTokens();
}

/**
 * Open Spotify's login in a popup. Once the popup is redirected back to the callback page
 * on this origin, its URL becomes readable and the code is taken from it. When it lands on
 * another origin (localhost, plain-http LAN hosts), the user pastes that URL into
 * {@link loginFromPastedUrl} instead. Completion stores the tokens, which re-renders the
 * window through the setting's onChange.
 */
export async function login() {
  const clientId = getClientId();
  if ( !clientId ) throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.NoClientId"));

  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirect = redirectUri();
  pending = {verifier, state, redirect};

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES.join(" ")
  }).toString();

  const popup = window.open(url.toString(), "mancer-spotify-login", "width=520,height=760");
  if ( !popup ) throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.PopupBlocked"));
  watchPopup(popup, state);
}

/** Whether a login was started in this window and is waiting for its code. */
export function isLoginPending() {
  return !!pending;
}

function watchPopup(popup, state) {
  clearInterval(popupWatch);
  popupWatch = setInterval(async () => {
    if ( popup.closed || (pending?.state !== state) ) return clearInterval(popupWatch);
    let href;
    try {
      // Throws while the popup shows Spotify's (cross-origin) pages.
      href = popup.location.href;
    } catch {
      return;
    }
    const params = new URL(href).searchParams;
    if ( !params.has("code") && !params.has("error") ) return;
    clearInterval(popupWatch);
    popup.close();
    try {
      await completeLogin({code: params.get("code"), state: params.get("state"), error: params.get("error")});
      ui.notifications.success("MANCER_SPOTIFY.Notifications.Connected", {localize: true});
    } catch(err) {
      ui.notifications.error(err.message);
    }
  }, 250);
}

/**
 * Finish a login from the URL the popup landed on after Spotify's login, for setups where
 * the popup ends on another origin than this window (plain-http LAN Foundry, localhost).
 * @param {string} pastedUrl
 */
export async function loginFromPastedUrl(pastedUrl) {
  let params;
  try {
    params = new URL(pastedUrl.trim()).searchParams;
  } catch {
    throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.BadPastedUrl"));
  }
  await completeLogin({
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error")
  });
}

async function completeLogin({code, state, error}) {
  if ( error ) throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.LoginDenied", {error}));
  if ( !pending || (state !== pending.state) ) {
    throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.LoginStateMismatch"));
  }
  if ( !code ) throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.BadPastedUrl"));
  const {verifier, redirect} = pending;
  pending = null;
  await storeTokens(await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    code_verifier: verifier
  }));
}

export async function logout() {
  pending = null;
  await setTokens(null);
}

/* -------------------------------------------- */
/*  Tokens                                      */
/* -------------------------------------------- */

/**
 * A valid access token, refreshing it first if it is about to expire.
 * @param {object} [options]
 * @param {boolean} [options.force]  Refresh even if the token looks valid (after a 401).
 * @returns {Promise<string>}
 */
export async function getAccessToken({force=false}={}) {
  const tokens = getTokens();
  if ( !tokens ) throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.NotConnected"));
  if ( !force && (Date.now() < tokens.expiresAt - EXPIRY_MARGIN_MS) ) return tokens.accessToken;
  refreshing ??= refresh(tokens).finally(() => refreshing = null);
  return refreshing;
}

async function refresh(tokens) {
  let data;
  try {
    data = await tokenRequest({grant_type: "refresh_token", refresh_token: tokens.refreshToken});
  } catch(err) {
    // A revoked or rotated-away refresh token can't recover: start over from Connect.
    if ( err.code === "invalid_grant" ) {
      await setTokens(null);
      throw new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.SessionExpired"));
    }
    throw err;
  }
  // Spotify may rotate the refresh token; keep the old one if it didn't.
  data.refresh_token ??= tokens.refreshToken;
  return (await storeTokens(data)).accessToken;
}

async function tokenRequest(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({client_id: getClientId(), ...params})
  });
  const data = await response.json().catch(() => ({}));
  if ( !response.ok ) {
    const err = new SpotifyAuthError(_loc("MANCER_SPOTIFY.Errors.TokenRequest", {
      error: data.error_description || data.error || response.status
    }));
    err.code = data.error;
    throw err;
  }
  return data;
}

async function storeTokens(data) {
  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000)
  };
  await setTokens(tokens);
  return tokens;
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
