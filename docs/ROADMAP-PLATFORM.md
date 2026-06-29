# Platform & lobby roadmap

Beyond the per-game engines, the platform itself (launcher + lobby + orchestrator) has its own
roadmap. Top of the list:

## Invite links (no codes to type) — partially done

Goal: share a link, the friend lands straight in your room. No "enter this 6-digit code".

**Done:** the `social` service mints opaque invite codes (`createInvite` / `inviteFriend`), resolves
them publicly via `GET /invite/:code`, and pushes invites into a friend's presence channel. The hub
has `resolveInvite(code)` for `?invite=CODE` deep links.

**Still to do:**

- Launcher auto-join: on load, if `?invite=<code>` / `?join=<code>` is present → after login,
  auto-`enter` the game and auto-join that room (skip the room list). Works for not-yet-logged-in
  users (login then join) and a cold game (orchestrator wakes it first). Today the code resolves but
  the auto-join flow isn't wired end-to-end.
- Per-game lobby must accept a join by the resolved room/role (the platform side is ready).
- Nice-to-haves: room **QR code** next to the link; invite **max-uses** (TTL exists, 1h); "copy link"
  button in the room view; deep-link straight into a specific game (`?game=civa&invite=…`).

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
