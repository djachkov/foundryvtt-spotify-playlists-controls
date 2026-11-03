import { MODULE_ID, registerSettings } from "./settings.mjs";
import { api, openWindow } from "./controller.mjs";
import { onHotbarDrop } from "./macros.mjs";

Hooks.once("init", () => {
  registerSettings();
  // Macros call this: game.modules.get("mancer_spotify_controls").api.playPlaylist("spotify:playlist:…")
  game.modules.get(MODULE_ID).api = api;
});

Hooks.on("hotbarDrop", onHotbarDrop);

/** A Spotify button in the Playlists sidebar header. */
Hooks.on("renderPlaylistDirectory", (_app, html) => {
  if ( !game.user.isGM ) return;
  const actions = html.querySelector(".header-actions");
  // The hook fires on every partial render; the header may already have the button.
  if ( !actions || actions.querySelector(".mancer-spotify-open") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mancer-spotify-open";
  button.innerHTML = `<i class="fa-brands fa-spotify" inert></i> <span>${_loc("MANCER_SPOTIFY.Title")}</span>`;
  button.addEventListener("click", () => openWindow());
  actions.append(button);
});

/** A Spotify tool in the Ambient Sound scene controls. */
Hooks.on("getSceneControlButtons", controls => {
  const sounds = controls.sounds;
  if ( !sounds ) return;
  sounds.tools.mancerSpotify = {
    name: "mancerSpotify",
    title: "MANCER_SPOTIFY.Title",
    icon: "fa-brands fa-spotify",
    order: Object.keys(sounds.tools).length + 1,
    button: true,
    visible: game.user.isGM,
    onChange: () => openWindow()
  };
});
