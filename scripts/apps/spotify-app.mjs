import { MODULE_ID, getClientId, setClientId, getSelectedPlaylists, setSelectedPlaylists } from "../settings.mjs";
import * as auth from "../auth.mjs";
import * as spotify from "../spotify-api.mjs";
import { ACTIONS, api, notifyError } from "../controller.mjs";
import { actionDragData, playlistDragData } from "../macros.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `modules/${MODULE_ID}/templates`;
const POLL_MS = 5000;

/**
 * The Spotify remote: setup, login, the chosen playlist tiles, playlist management, a
 * playlist's songs, and a now-playing bar. Tiles and player buttons drag onto the hotbar.
 */
export default class SpotifyApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "mancer-spotify",
    classes: ["mancer-spotify"],
    window: {
      title: "MANCER_SPOTIFY.Title",
      icon: "fa-brands fa-spotify",
      resizable: true
    },
    position: {width: 620, height: 640},
    actions: {
      saveClientId: SpotifyApp.#onSaveClientId,
      editClientId: SpotifyApp.#onEditClientId,
      copyRedirect: SpotifyApp.#onCopyRedirect,
      connect: SpotifyApp.#onConnect,
      pasteUrl: SpotifyApp.#onPasteUrl,
      disconnect: SpotifyApp.#onDisconnect,
      switchView: SpotifyApp.#onSwitchView,
      playPlaylist: SpotifyApp.#onPlayPlaylist,
      openTracks: SpotifyApp.#onOpenTracks,
      back: SpotifyApp.#onBack,
      playTrack: SpotifyApp.#onPlayTrack,
      togglePlaylist: SpotifyApp.#onTogglePlaylist,
      refreshPlaylists: SpotifyApp.#onRefreshPlaylists,
      player: SpotifyApp.#onPlayer
    }
  };

  static PARTS = {
    content: {
      template: `${TEMPLATES}/content.hbs`,
      templates: ["setup", "connect", "playlists", "manage", "tracks"].map(t => `${TEMPLATES}/${t}.hbs`),
      scrollable: [".mancer-spotify-scroll"]
    },
    player: {
      template: `${TEMPLATES}/player.hbs`
    }
  };

  /** "playlists" | "manage" | "tracks" */
  #view = "playlists";

  /** Whether the setup screen was reopened to change an existing Client ID. */
  #editingClientId = false;

  /** All of the user's playlists, loaded when Manage is first opened. */
  #allPlaylists = null;

  /** The playlist whose songs are shown, with its loaded songs. */
  #tracks = null;

  #loading = false;

  /** The last playback state from Spotify; undefined until the first poll. */
  #playback;

  #pollTimer = null;

  #dragDrop = new foundry.applications.ux.DragDrop.implementation({
    dragSelector: "[data-spotify-drag]",
    callbacks: {dragstart: this.#onDragStart.bind(this)}
  });

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const clientId = getClientId();
    const connected = auth.isConnected();
    let screen = "main";
    if ( !clientId || this.#editingClientId ) screen = "setup";
    else if ( !connected ) screen = "connect";

    const selected = getSelectedPlaylists();
    const selectedIds = new Set(selected.map(p => p.id));
    Object.assign(context, {
      screen,
      connected: screen === "main",
      view: this.#view,
      partial: `${TEMPLATES}/${screen === "main" ? this.#view : screen}.hbs`,
      clientId,
      redirectUri: auth.redirectUri(),
      redirectProblem: auth.redirectUriProblem(),
      loginPending: auth.isLoginPending(),
      loading: this.#loading,
      selected,
      allPlaylists: this.#allPlaylists?.map(p => ({...p, selected: selectedIds.has(p.id)})),
      tracks: this.#tracks,
      fallbackImage: `modules/${MODULE_ID}/icons/playlist.svg`,
      actions: Object.entries(ACTIONS).map(([action, a]) => ({action, ...a})),
      playback: this.#playbackContext()
    });
    return context;
  }

  #playbackContext() {
    const state = this.#playback;
    if ( !state ) return {active: false, known: state !== undefined};
    const item = state.item;
    return {
      active: true,
      known: true,
      playing: state.is_playing,
      title: item?.name ?? "",
      artists: item?.artists?.map(a => a.name).join(", ") || item?.show?.name || "",
      image: item?.album?.images?.at(-1)?.url ?? item?.images?.at(-1)?.url ?? null,
      device: state.device?.name ?? "",
      shuffle: state.shuffle_state,
      repeat: state.repeat_state,
      repeatTrack: state.repeat_state === "track"
    };
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#dragDrop.bind(this.element);
    if ( context.connected ) this.#startPolling();
    else this.#stopPolling();
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    this.#stopPolling();
  }

  /* -------------------------------------------- */
  /*  Playback polling                            */
  /* -------------------------------------------- */

  #startPolling() {
    if ( this.#pollTimer ) return;
    this.#pollTimer = setInterval(() => this.refreshPlayback(), POLL_MS);
    this.refreshPlayback();
  }

  #stopPolling() {
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  /** Fetch the playback state and redraw the now-playing bar. */
  async refreshPlayback() {
    if ( !this.rendered || !auth.isConnected() ) return;
    try {
      this.#playback = await spotify.getPlaybackState();
    } catch(err) {
      // Polling stays quiet; an expired session clears the tokens and re-renders to Connect.
      if ( err instanceof auth.SpotifyAuthError ) return this.render();
      console.warn(`${MODULE_ID} | playback poll failed`, err);
      return;
    }
    if ( this.rendered ) this.render({parts: ["player"]});
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  #onDragStart(event) {
    const el = event.currentTarget;
    let data;
    if ( el.dataset.spotifyDrag === "playlist" ) {
      const playlist = getSelectedPlaylists().find(p => p.id === el.dataset.id);
      if ( playlist ) data = playlistDragData(playlist);
    }
    else if ( el.dataset.spotifyDrag === "action" ) data = actionDragData(el.dataset.command);
    if ( data ) event.dataTransfer.setData("text/plain", JSON.stringify(data));
  }

  /* -------------------------------------------- */
  /*  Data loading                                */
  /* -------------------------------------------- */

  async #loadPlaylists() {
    this.#loading = true;
    await this.render();
    try {
      this.#allPlaylists = await spotify.getMyPlaylists();
      // Keep the stored tiles' names and covers current.
      const byId = new Map(this.#allPlaylists.map(p => [p.id, p]));
      const selected = getSelectedPlaylists();
      const updated = selected.map(p => byId.has(p.id) ? toStored(byId.get(p.id)) : p);
      if ( !foundry.utils.objectsEqual(selected, updated) ) await setSelectedPlaylists(updated);
    } catch(err) {
      notifyError(err);
    } finally {
      this.#loading = false;
      this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onSaveClientId() {
    const value = this.element.querySelector("input[name=clientId]")?.value ?? "";
    if ( !value.trim() ) return ui.notifications.warn("MANCER_SPOTIFY.Errors.NoClientId", {localize: true});
    // A different app means the stored tokens belong to someone else's app.
    if ( value.trim() !== getClientId() ) await auth.logout();
    this.#editingClientId = false;
    await setClientId(value);
    this.render();
  }

  static #onEditClientId() {
    this.#editingClientId = true;
    this.render();
  }

  static async #onCopyRedirect() {
    await game.clipboard.copyPlainText(auth.redirectUri());
    ui.notifications.info("MANCER_SPOTIFY.Notifications.Copied", {localize: true});
  }

  static async #onConnect() {
    try {
      await auth.login();
    } catch(err) {
      notifyError(err);
    }
    this.render();
  }

  static async #onPasteUrl() {
    const value = this.element.querySelector("textarea[name=pastedUrl]")?.value ?? "";
    try {
      await auth.loginFromPastedUrl(value);
      ui.notifications.success("MANCER_SPOTIFY.Notifications.Connected", {localize: true});
    } catch(err) {
      notifyError(err);
    }
  }

  static async #onDisconnect() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: "MANCER_SPOTIFY.Disconnect"},
      content: `<p>${_loc("MANCER_SPOTIFY.DisconnectConfirm")}</p>`
    });
    if ( !confirmed ) return;
    this.#playback = undefined;
    this.#allPlaylists = null;
    this.#tracks = null;
    await auth.logout();
  }

  static #onSwitchView(_event, target) {
    this.#view = target.dataset.view;
    this.render({parts: ["content"]});
    if ( (this.#view === "manage") && !this.#allPlaylists ) this.#loadPlaylists();
  }

  static #onPlayPlaylist(_event, target) {
    api.playPlaylist(target.closest("[data-uri]").dataset.uri);
  }

  static async #onOpenTracks(_event, target) {
    const playlist = getSelectedPlaylists().find(p => p.id === target.closest("[data-id]").dataset.id);
    if ( !playlist ) return;
    this.#view = "tracks";
    this.#tracks = {playlist, loading: true, unavailable: false, items: []};
    this.render({parts: ["content"]});
    try {
      const {unavailable, tracks} = await spotify.getPlaylistTracks(playlist.id);
      if ( this.#tracks?.playlist !== playlist ) return;
      this.#tracks = {playlist, loading: false, unavailable, items: tracks.map((t, i) => ({
        ...t, number: i + 1, length: formatDuration(t.duration)
      }))};
    } catch(err) {
      notifyError(err);
      this.#tracks.loading = false;
    }
    this.render({parts: ["content"]});
  }

  static #onBack() {
    this.#view = "playlists";
    this.#tracks = null;
    this.render({parts: ["content"]});
  }

  static #onPlayTrack(_event, target) {
    if ( !this.#tracks ) return;
    api.playTrack(this.#tracks.playlist.uri, target.closest("[data-uri]").dataset.uri);
  }

  static async #onTogglePlaylist(_event, target) {
    const playlist = this.#allPlaylists?.find(p => p.id === target.closest("[data-id]").dataset.id);
    if ( !playlist ) return;
    const selected = getSelectedPlaylists().filter(p => p.id !== playlist.id);
    if ( target.checked ) selected.push(toStored(playlist));
    await setSelectedPlaylists(selected);
    this.render({parts: ["content"]});
  }

  static #onRefreshPlaylists() {
    this.#loadPlaylists();
  }

  static #onPlayer(_event, target) {
    api[target.dataset.command]?.();
  }
}

/** The fields of a playlist kept in the selectedPlaylists setting. */
function toStored({id, uri, name, image}) {
  return {id, uri, name, image};
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
