# Platform & lobby roadmap

Beyond the per-game engines, the platform itself (launcher + lobby + orchestrator) has its own
roadmap. Top of the list:

## Invite links (no codes to type) — platform side done

Goal: share a link, the friend lands straight in your room. No "enter this 6-digit code".

**Done:** the `social` service mints opaque invite codes (`createInvite` / `inviteFriend`), resolves
them publicly via `GET /invite/:code`, and pushes invites into a friend's presence channel. The
launcher auto-joins: on load, `App.tsx` reads `?invite=<code>` and — once logged in (prompting login
first if needed) — resolves it and calls `routeToInvite` (wake the game via the orchestrator, mint a
handoff token, navigate to `?pt=<handoff>&join=<room>`). A friend's pushed invite and a shared link
both land in the same place (the 🔔 notification center) and both resolve through the same
`routeToInvite` call.

**Still to do:**

- **Sending** an invite from a real in-game moment. Nothing in this repo calls `createInvite`/
  `inviteFriend` today except a hub demo button — the actual trigger belongs in the game itself (its
  lobby/room UI), which needs `mygame.social.*` to expose those methods first (today they only exist
  on the React `useSocialStore` hook).
- Per-game lobby must accept a join by the resolved room/role — that's on each game (CIVA's lobby is
  outside this repo); the platform side (resolving the code, carrying `room`/`role` to the game's URL)
  is ready.
- Nice-to-haves: room **QR code** next to the link; invite **max-uses** (TTL exists, 1h); deep-link
  straight into a specific game (`?game=civa&invite=…`, useful once more than one game is launchable
  from the same origin).

## Cool, convenient lobby features (proposed)

Pick-and-choose; ordered roughly by value/effort.

1. **Drop-in & spectate** — let people watch a running game or fill an open seat mid-match
   (the lobby already tracks seats; add a `spectator` role + a "watch" button on running rooms).
2. **Lobby voice/video (LiveKit)** — LiveKit is already on the server. A "talk in the lobby" toggle
   so a party can chat while picking nations / readying up; carries into the game's caucus.
3. **Ready-check & auto-start** — host hits "ready check"; everyone gets a 10s accept prompt; the
   game auto-starts when all accept (no manual "Start" needed).
4. **Parties / friends** — keep a group together across games: invite a party, then pick a game once
   for the whole party. Pairs perfectly with invite links.
5. **Presence & rejoin banner** — show which of your recent rooms are still alive ("Brazil's game is
   waiting — rejoin"), powered by the orchestrator's game/player view.
6. **Fill with bots** — for under-filled lobbies, add AI seats so a game can start; humans can take
   over a bot seat later.
7. **Quick-match** — one button: "play CIVA now" → joins an open waiting room or makes one and waits;
   the orchestrator wakes the game on demand.
8. **Room settings** — host options surfaced cleanly: map seed, year length, min players, private vs
   public (private = invite-link-only, hidden from the room list).
9. **Reconnect grace UX** — already enforced server-side; surface it ("Wei dropped — 45s to rejoin")
   and let the host kick/replace after the grace window.
10. **Cross-device handoff** — start on PC, scan a QR to bring your phone in as the companion
    (mic/cam + diplomacy), same account/seat. The companion app is already in the plan.

These layer cleanly on the current lobby (server-authoritative, account-bound seats, reconnect) and
the orchestrator (per-game wake/idle), so most are additive.
