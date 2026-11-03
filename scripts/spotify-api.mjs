import { getAccessToken } from "./auth.mjs";

const API_URL = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  constructor(message, {status, reason}={}) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Call the Spotify Web API. Retries once after a 401 (with a fresh token) or a 429 (after
 * Retry-After). Never sends device_id, so player calls act on the currently active device.
 * @param {string} method
 * @param {string} path             Path under /v1, or a full "next" URL from a paging object
 * @param {object} [options]
 * @param {object} [options.query]
 * @param {object} [options.body]
 * @returns {Promise<object|null>}  The JSON body, or null for an empty response
 */
export async function request(method, path, {query, body}={}, retried=false) {
  const url = new URL(path.startsWith("https://") ? path : API_URL + path);
  for ( const [k, v] of Object.entries(query ?? {}) ) url.searchParams.set(k, v);

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken({force: retried === 401})}`,
      ...(body ? {"Content-Type": "application/json"} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if ( !retried && (response.status === 401) ) return request(method, path, {query, body}, 401);
  if ( !retried && (response.status === 429) ) {
    const seconds = Number(response.headers.get("Retry-After")) || 1;
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return request(method, path, {query, body}, 429);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if ( !response.ok ) {
    const error = data?.error ?? {};
    throw new SpotifyError(error.message || `Spotify returned ${response.status}`, {
      status: response.status,
      reason: error.reason
    });
  }
  return data;
}

/** Follow a paging object's "next" links and collect every item. */
async function collectPages(path, query) {
  const items = [];
  let page = await request("GET", path, {query});
  while ( page ) {
    items.push(...(page.items ?? []));
    page = page.next ? await request("GET", page.next) : null;
  }
  return items;
}

/* -------------------------------------------- */
/*  Library                                     */
/* -------------------------------------------- */

/**
 * The current user's playlists (owned and followed), reduced to what the module stores.
 * @returns {Promise<{id: string, uri: string, name: string, image: string|null, owner: string,
 *   total: number|null}[]>}
 */
export async function getMyPlaylists() {
  const playlists = await collectPages("/me/playlists", {limit: 50});
  return playlists.filter(p => p).map(p => ({
    id: p.id,
    uri: p.uri,
    name: p.name,
    image: pickImage(p.images),
    owner: p.owner?.display_name ?? p.owner?.id ?? "",
    // Development-mode responses renamed "tracks" to "items".
    total: p.items?.total ?? p.tracks?.total ?? null
  }));
}

/**
 * The songs of a playlist. Spotify only lists songs of playlists the user owns or
 * collaborates on; for other playlists this returns {unavailable: true}.
 * @param {string} playlistId
 * @returns {Promise<{unavailable: boolean, tracks: {uri: string, name: string, artists: string,
 *   duration: number, image: string|null}[]}>}
 */
export async function getPlaylistTracks(playlistId) {
  let entries;
  try {
    entries = await collectPages(`/playlists/${playlistId}/items`, {limit: 50});
  } catch(err) {
    if ( [403, 404].includes(err.status) ) return {unavailable: true, tracks: []};
    throw err;
  }
  const tracks = entries
    .map(entry => entry.item ?? entry.track)
    .filter(track => track?.uri && !track.is_local)
    .map(track => ({
      uri: track.uri,
      name: track.name,
      // Podcast episodes have a show instead of artists.
      artists: track.artists?.map(a => a.name).join(", ") || track.show?.name || "",
      duration: track.duration_ms ?? 0,
      image: pickImage(track.album?.images ?? track.images, true)
    }));
  return {unavailable: false, tracks};
}

/* -------------------------------------------- */
/*  Player                                      */
/* -------------------------------------------- */

/** @returns {Promise<object|null>} The playback state, or null when nothing is active. */
export function getPlaybackState() {
  return request("GET", "/me/player");
}

/**
 * Start or resume playback on the active device.
 * @param {object} [options]
 * @param {string} [options.contextUri]  A playlist/album URI to play
 * @param {string} [options.offsetUri]   A track URI inside that context to start from
 */
export function play({contextUri, offsetUri}={}) {
  const body = {};
  if ( contextUri ) body.context_uri = contextUri;
  if ( offsetUri ) body.offset = {uri: offsetUri};
  return request("PUT", "/me/player/play", {body: contextUri ? body : undefined});
}

export function pause() {
  return request("PUT", "/me/player/pause");
}

export function next() {
  return request("POST", "/me/player/next");
}

export function previous() {
  return request("POST", "/me/player/previous");
}

export function setShuffle(state) {
  return request("PUT", "/me/player/shuffle", {query: {state}});
}

/** @param {"off"|"context"|"track"} state */
export function setRepeat(state) {
  return request("PUT", "/me/player/repeat", {query: {state}});
}

/* -------------------------------------------- */

/** The smallest image that is still at least 300px wide (or the largest one if none is). */
function pickImage(images, small=false) {
  if ( !images?.length ) return null;
  const min = small ? 64 : 300;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find(i => (i.width ?? 0) >= min) ?? sorted.at(-1)).url;
}
