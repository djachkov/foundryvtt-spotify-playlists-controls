export const MODULE_ID = "mancer_spotify_controls";

export function registerSettings() {
  game.settings.register(MODULE_ID, "clientId", {
    name: "MANCER_SPOTIFY.Settings.ClientId.Name",
    hint: "MANCER_SPOTIFY.Settings.ClientId.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshApp()
  });

  // Tokens stay in this browser's localStorage, never in the world database.
  game.settings.register(MODULE_ID, "tokens", {
    scope: "client",
    config: false,
    type: Object,
    default: null,
    onChange: () => refreshApp()
  });

  game.settings.register(MODULE_ID, "selectedPlaylists", {
    scope: "user",
    config: false,
    type: Array,
    default: []
  });
}

export function getClientId() {
  return game.settings.get(MODULE_ID, "clientId")?.trim() ?? "";
}

export function setClientId(value) {
  return game.settings.set(MODULE_ID, "clientId", value.trim());
}

/** @returns {{accessToken: string, refreshToken: string, expiresAt: number}|null} */
export function getTokens() {
  const tokens = game.settings.get(MODULE_ID, "tokens");
  return tokens?.accessToken ? tokens : null;
}

export function setTokens(tokens) {
  return game.settings.set(MODULE_ID, "tokens", tokens);
}

/** @returns {{id: string, uri: string, name: string, image: string|null}[]} */
export function getSelectedPlaylists() {
  return game.settings.get(MODULE_ID, "selectedPlaylists") ?? [];
}

export function setSelectedPlaylists(playlists) {
  return game.settings.set(MODULE_ID, "selectedPlaylists", playlists);
}

function refreshApp() {
  foundry.applications.instances.get("mancer-spotify")?.render();
}
