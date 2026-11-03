import { MODULE_ID } from "./settings.mjs";
import { ACTIONS, iconPath } from "./controller.mjs";

/** The drag data type the hotbar receives from the Spotify window. */
export const DRAG_TYPE = "MancerSpotify";

/**
 * Drag data for a playlist tile.
 * @param {{uri: string, name: string, image: string|null}} playlist
 */
export function playlistDragData(playlist) {
  return {type: DRAG_TYPE, kind: "playlist", uri: playlist.uri, name: playlist.name, image: playlist.image};
}

/** @param {string} action  A key of {@link ACTIONS} */
export function actionDragData(action) {
  return {type: DRAG_TYPE, kind: "action", action};
}

/**
 * hotbarDrop handler. Core ignores drop data whose type isn't a document, so this must
 * claim the drop synchronously by returning false and create the macro afterwards.
 */
export function onHotbarDrop(_hotbar, data, slot) {
  if ( data?.type !== DRAG_TYPE ) return;
  if ( game.user.isGM ) createSpotifyMacro(data, Number(slot)).catch(err => {
    ui.notifications.error(err.message);
    console.error(`${MODULE_ID} |`, err);
  });
  return false;
}

async function createSpotifyMacro(data, slot) {
  const macroData = macroDataFor(data);
  if ( !macroData ) return;
  // Dropping the same playlist or action again reuses its macro.
  const macro = game.macros.find(m => (m.command === macroData.command) && m.isOwner)
    ?? await Macro.implementation.create(macroData);
  await game.user.assignHotbarMacro(macro, slot);
}

function macroDataFor(data) {
  const api = `game.modules.get("${MODULE_ID}")?.api`;
  if ( data.kind === "playlist" ) {
    if ( !/^spotify:playlist:[A-Za-z0-9]+$/.test(data.uri ?? "") ) return null;
    return {
      name: data.name || _loc("MANCER_SPOTIFY.Title"),
      type: CONST.MACRO_TYPES.SCRIPT,
      img: macroImage(data.image),
      command: `await ${api}.playPlaylist("${data.uri}");`,
      flags: {[MODULE_ID]: {kind: "playlist", uri: data.uri}}
    };
  }
  if ( data.kind === "action" ) {
    const action = ACTIONS[data.action];
    if ( !action ) return null;
    return {
      name: `Spotify: ${_loc(action.label)}`,
      type: CONST.MACRO_TYPES.SCRIPT,
      img: iconPath(action.img),
      command: `await ${api}.${data.action}();`,
      flags: {[MODULE_ID]: {kind: "action", action: data.action}}
    };
  }
  return null;
}

/**
 * Spotify's cover URLs have no file extension, which Macro's image field requires. A
 * "#.jpg" fragment satisfies the check and is never sent to Spotify's CDN.
 * @param {string|null} url
 */
function macroImage(url) {
  if ( !url?.startsWith("https://") ) return iconPath("playlist");
  return `${url}#.jpg`;
}
