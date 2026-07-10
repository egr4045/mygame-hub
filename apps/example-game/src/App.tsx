import { useEffect, useState } from 'react';
import { mygame, type MygameAccount } from '@mygame/sdk';
import type { ChangelogEntry, DiscussionThread, GameStat } from '@mygame/protocol';

const GAME_ID = 'example-game';
// Same VITE_HUB_URL baked in for mygame.init() below, if explicitly set (a deploy that puts this on
// its own origin/port rather than a path). Otherwise: in prod this is deployed path-routed under the
// hub's own origin (mygame-quiz.ru/example-game/) — the hub itself is right there at the origin
// root, no port needed, no protocol mismatch possible. Dev falls back to the hub's own dev server
// (its own port, since dev doesn't have the prod gateway's path routing) — never inherit
// window.location.protocol there either (this app's own dev port isn't TLS-terminated).
const HUB_ORIGIN =
  (import.meta.env.VITE_HUB_URL as string | undefined) ??
  (import.meta.env.DEV
    ? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:5180`
    : typeof window !== 'undefined'
      ? window.location.origin
      : '');

/**
 * Reads the `sub`/`name` claims out of a handoff JWT without verifying its signature. That's fine
 * here only because the very next step re-verifies identity the same way `mygame.auth.login` always
 * does on this platform: passwordless re-claim by account id (see docs/STATUS.md — a deliberate
 * simplification, not something this example invented). A real game with its own backend should
 * instead verify the token server-side and mint its own session — see docs/SSO-FEDERATION.md.
 */
const decodeHandoffClaims = (token: string): { sub: string; name: string } | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // atob() yields a binary string (one UTF-8 byte per char) — re-encode each byte as %XX and run
    // decodeURIComponent to correctly reassemble multi-byte UTF-8 (e.g. Cyrillic display names).
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const json = decodeURIComponent(
      [...binary].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    const claims = JSON.parse(json) as { sub?: string; name?: string };
    return claims.sub && claims.name ? { sub: claims.sub, name: claims.name } : null;
  } catch {
    return null;
  }
};

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid #2a3f5a',
  borderRadius: 8,
  padding: 24,
};

const button: React.CSSProperties = {
  background: '#1a9fff',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '10px 20px',
  fontWeight: 600,
  cursor: 'pointer',
};

/** Whether the URL carries an unconsumed handoff token right now (checked once, before it's stripped). */
const hasPendingHandoff = (): boolean =>
  typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('pt');

export const App = (): JSX.Element => {
  // A `?pt=` handoff always wins over whatever session (possibly a stale/different account) is
  // already on this origin — seeding `account` from it here would let the SDK bootstrap effect
  // below fire on that stale session before the handoff below has a chance to correct it.
  const [account, setAccount] = useState<MygameAccount | null>(() => (hasPendingHandoff() ? null : mygame.auth.getAccount()));
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [joinable, setJoinable] = useState(false);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [wonMessage, setWonMessage] = useState<string | null>(null);

  // Handoff from the hub (`?pt=<token>`): log into this origin as the same platform account, then
  // strip the token from the URL so it never lingers in history.
  useEffect(() => {
    const url = new URL(window.location.href);
    const pt = url.searchParams.get('pt');
    if (!pt) return;
    url.searchParams.delete('pt');
    window.history.replaceState({}, '', url.toString());
    const claims = decodeHandoffClaims(pt);
    if (!claims) return;
    void mygame.auth.login(claims.name, claims.sub).then(() => setAccount(mygame.auth.getAccount()));
  }, []);

  // Bootstrap the SDK once we have an account. In dev this needs no options — the SDK's own
  // defaults already point at each platform service's local port. A deployed game passes
  // `{ hubUrl: '...' }` (e.g. via VITE_HUB_URL) so one build works against any hub.
  useEffect(() => {
    if (!account || initialized) return;
    const hubUrl = import.meta.env.VITE_HUB_URL as string | undefined;
    mygame.init(GAME_ID, hubUrl ? { hubUrl } : {});
    setInitialized(true);
  }, [account, initialized]);

  useEffect(() => {
    if (!initialized) return;
    void mygame.stats.getStats().then(setStats);
    void mygame.community.getChangelog().then(setChangelog);
    void mygame.community.getThreads().then(setThreads);

    mygame.social.setActivity({
      game: GAME_ID,
      gameName: 'Example Game',
      room: null,
      joinable: false,
    });
  }, [initialized]);

  const handleLogin = async (): Promise<void> => {
    if (!displayNameInput.trim()) return;
    await mygame.auth.login(displayNameInput.trim());
    setAccount(mygame.auth.getAccount());
  };

  const handleWin = async (): Promise<void> => {
    const granted = await mygame.achievements.grant('first_win');
    setWonMessage(granted ? 'Новое достижение открыто! Проверь тост в углу.' : 'Уже получено раньше — открой один раз в другой игре, чтобы увидеть тост.');
    setStats(await mygame.stats.getStats());
  };

  const toggleJoinable = (next: boolean): void => {
    setJoinable(next);
    mygame.social.setActivity({
      game: GAME_ID,
      gameName: 'Example Game',
      room: next ? 'demo-room' : null,
      joinable: next,
    });
  };

  const myStat = stats.find((s) => s.gameId === GAME_ID);

  if (!account) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#12161d', color: '#dcdedf', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ ...card, width: 360, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Example Game</h1>
          <p style={{ color: '#8f98a0', fontSize: 13, marginBottom: 24 }}>Войдите, чтобы попробовать @mygame/sdk</p>
          <input
            placeholder="Ваше имя"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            style={{ width: '100%', boxSizing: 'border-box', background: '#171a21', border: '1px solid #2a3f5a', borderRadius: 4, padding: '10px 12px', color: '#fff', marginBottom: 12 }}
          />
          <button onClick={() => void handleLogin()} style={{ ...button, width: '100%' }}>Войти</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#12161d', color: '#dcdedf', fontFamily: 'system-ui, sans-serif', padding: '40px 5%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Example Game</h1>
          <p style={{ color: '#8f98a0', fontSize: 13, margin: '4px 0 0' }}>Живой пример использования @mygame/sdk — {account.displayName}</p>
        </div>
        <a href={HUB_ORIGIN} style={{ color: '#66c0f4', fontSize: 13 }}>← Назад в Хаб</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Достижения</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}><code>mygame.achievements.grant(id)</code> — идемпотентно, тост показывается автоматически.</p>
          <button onClick={() => void handleWin()} style={button}>🏆 Одержать победу</button>
          {wonMessage && <p style={{ fontSize: 12, color: '#5c7e10', marginTop: 12 }}>{wonMessage}</p>}
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Активность и присутствие</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}><code>mygame.social.setActivity(...)</code> — друзья видят, во что вы играете; хаб показывает открытые лобби.</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={joinable} onChange={(e) => toggleJoinable(e.target.checked)} />
            Открыто для друзей (комната "demo-room")
          </label>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Чат и друзья</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}>Оверлей (тосты, меню, чат, друзья) монтируется сам при <code>mygame.init()</code>.</p>
          <button onClick={() => mygame.chat.open()} style={button}>💬 Открыть чат</button>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Время в игре</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}><code>mygame.init()</code> уже отправляет heartbeat каждые ~30с, пока вкладка открыта.</p>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{myStat?.secondsPlayed ?? 0} сек</div>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Ченжлог</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}><code>mygame.community.getChangelog()</code></p>
          {changelog.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6c7784' }}>Пока пусто.</div>
          ) : (
            changelog.map((e) => <div key={e.id} style={{ fontSize: 13, marginBottom: 8 }}>{e.version}: {e.title}</div>)
          )}
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', color: '#8f98a0', marginTop: 0 }}>Обсуждения</h2>
          <p style={{ fontSize: 13, color: '#8f98a0' }}><code>mygame.community.getThreads()</code></p>
          {threads.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6c7784' }}>Пока нет тем.</div>
          ) : (
            threads.map((t) => <div key={t.id} style={{ fontSize: 13, marginBottom: 8 }}>{t.title} · {t.replyCount} ответ(ов)</div>)
          )}
        </div>
      </div>
    </div>
  );
};
