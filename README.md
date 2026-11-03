# Mancer Spotify

A Foundry VTT v14 module that remote-controls **your own Spotify playback** from inside
the game. Foundry plays no audio. The music plays in whatever Spotify app you have
running (desktop, phone, web player), and the module tells it what to do.

- Pick which of your playlists show up as tiles.
- Click a tile to play the playlist, or open it and start a specific song.
- Drag a tile onto the hotbar to get a one-click "play this playlist" macro.
- Drag a player button (Play/Pause, Next, Previous, Stop, Shuffle, Repeat) onto the
  hotbar for an action macro.

GM only: players don't see the window, and a Spotify macro clicked by a player does
nothing.

## Requirements

- **Spotify Premium.** Spotify only allows playback control with Premium.
- **Your own Spotify app** (free, takes two minutes). No server and no client secret
  are needed: the module uses Spotify's PKCE login flow directly from the browser.

## Setup

1. Enable the module in your world.
2. Open the Spotify window. You can use the **Spotify** button at the top of the
   Playlists sidebar tab, or the Spotify tool in the Ambient Sound scene controls.
3. Create an app at <https://developer.spotify.com/dashboard>:
   - Tick **Web API**.
   - Under **Redirect URIs**, add the exact address the Spotify window shows. It is
     `<your Foundry URL>/modules/mancer_spotify/callback.txt`, for example
     `https://foundry.example.com/modules/mancer_spotify/callback.txt` or
     `http://127.0.0.1:30000/modules/mancer_spotify/callback.txt`.
4. Paste the app's **Client ID** into the window and save.
5. Click **Connect Spotify** and log in. The popup closes by itself.
6. Under **Choose Playlists**, tick the playlists you want as tiles.

Start playing something in Spotify on any device once. After that, the module controls
that device, because commands always go to your currently active Spotify device.

### Which Foundry address works

Spotify only accepts HTTPS redirect URIs, or `http://127.0.0.1`. It rejects
`localhost`.

| Foundry is opened at | What to do |
|---|---|
| `https://…` | Works as is. |
| `http://127.0.0.1:30000` | Works as is. |
| `http://localhost:30000` | Prefer opening Foundry at `http://127.0.0.1:30000` instead. Otherwise see the next row. |
| `http://192.168.x.x:30000` (LAN, no HTTPS) | Register the `http://127.0.0.1:<port>/…` address the window shows. After login the popup lands on a page that may not load. Copy its full address and paste it into **Paste the redirect URL**. |

Every Foundry address you use needs its own Redirect URI entry in the dashboard.

### Spotify development-mode limits

New Spotify apps run in development mode:

- The app owner must have Premium.
- At most 5 Spotify accounts can use the app. Add other GMs under **User Management**
  in the dashboard. You don't need to add yourself.
- Song lists are only available for playlists you own or collaborate on. For playlists
  you merely follow, you can still play the whole playlist, but the module can't list
  its songs.

## Macros

The macros are ordinary script macros that call the module's API, so you can also
write your own:

```js
const spotify = game.modules.get("mancer_spotify").api;
await spotify.playPlaylist("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
await spotify.playTrack("spotify:playlist:…", "spotify:track:…"); // continues with the playlist
await spotify.playPause();
await spotify.next();
await spotify.previous();
await spotify.stop();          // Spotify has no stop; this pauses
await spotify.toggleShuffle();
await spotify.cycleRepeat();   // off → playlist → track → off
spotify.openWindow();
```

## Where things are stored

| What | Where |
|---|---|
| Client ID | World setting. Not a secret. |
| Spotify login tokens | This browser's localStorage only. Never stored in the world. Disconnect clears them. |
| Chosen playlists | Your Foundry user, so they follow you to other browsers. |

## Development

The module source is in `scripts/`:

| File | Contents |
|---|---|
| `main.mjs` | Hooks |
| `auth.mjs` | PKCE login and token refresh |
| `spotify-api.mjs` | Web API calls |
| `controller.mjs` | Public API |
| `macros.mjs` | Hotbar drop |
| `apps/spotify-app.mjs` | The window |

About the login callback: Foundry serves any `.html` file in the data folder as plain
text, so no callback page can run script. Instead, `callback.txt` is a plain-text
landing page. The opener reads the code out of the popup's URL once the popup is back
on Foundry's origin.
