import { useEffect, useState } from 'react';
import { useCallStore } from '../../state/callStore.js';
import { getHandoff } from '../../authClient.js';
import { wakeGame, waitGameReady } from '../../wakeGame.js';
import { initials, avatarColor } from './callLayout.js';
import { mg, mgZ } from '../../theme/tokens.js';
import { btn, surfaceWindow } from '../../theme/primitives.js';
import { playSound } from '../../sound.js';

/**
 * Приглашение в игру — по центру экрана, как «match found» в Dota/CS.
 *
 * Раньше это была тонкая полоска ВНУТРИ окна звонка: докнутое окно 460×380 в углу, полоска ~30px
 * под заголовком. Позвавшего просто не замечали. Теперь это отдельная модалка поверх всего:
 * монтируется рядом с CallView (а не внутри), поэтому не зависит ни от того, открыто ли окно
 * звонка, ни от его размера.
 *
 * Приглашение прилетает по data-каналу LiveKit (`callStore.pendingInvite`), у канала нет истории —
 * поэтому Свояк перерассылает его опоздавшим (см. useCallInvite на стороне игры).
 */
export const GameInviteModal = (): JSX.Element | null => {
  const pendingInvite = useCallStore((s) => s.pendingInvite);
  const dismissInvite = useCallStore((s) => s.dismissInvite);
  const [going, setGoing] = useState(false);

  // Звук: приглашение легко пропустить, если человек в другой вкладке
  useEffect(() => {
    if (pendingInvite) playSound('call');
  }, [pendingInvite?.room, pendingInvite?.game]);

  // Esc — «позже». Модалка блокирующая по вниманию, но не по действию.
  useEffect(() => {
    if (!pendingInvite) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissInvite();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingInvite, dismissInvite]);

  if (!pendingInvite) return null;

  const goToInvite = async () => {
    setGoing(true);
    try {
      // Игра могла быть погашена как простаивающая: без побудки переход по приглашению
      // стабильно упирался в 502 шлюза.
      await wakeGame(pendingInvite.game);
      const url = new URL(pendingInvite.url, window.location.href);
      await waitGameReady(url.toString());
      const pt = await getHandoff();
      if (pt) url.searchParams.set('pt', pt);
      url.searchParams.set('join', pendingInvite.room);
      // Ключ звонка едет с собой: resume() на origin игры переподключится в тот же LiveKit-рум,
      // и никто в звонке не переподключается заново.
      url.searchParams.set('call', `game:${pendingInvite.game}:${pendingInvite.room}`);
      window.location.href = url.toString();
    } catch {
      setGoing(false);
      dismissInvite();
    }
  };

  const from = pendingInvite.fromName || 'Участник звонка';

  return (
    <div
      onClick={dismissInvite}
      style={{
        position: 'fixed',
        inset: 0,
        background: mg.overlay,
        zIndex: mgZ.modal,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        pointerEvents: 'auto', // хост оверлея — pointer-events:none, иначе клики не дойдут
      }}
    >
      <div
        className="mygame-invite-pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...surfaceWindow,
          width: 420,
          maxWidth: '100%',
          padding: '28px 28px calc(24px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: mg.accent }}>
          Приглашение в игру
        </div>

        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: avatarColor(pendingInvite.fromAccountId),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            fontWeight: 700,
            color: '#fff',
            animation: 'mygame-call-pulse 1.4s ease-out infinite',
          }}
        >
          {initials(from)}
        </div>

        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{pendingInvite.gameName}</div>
          <div style={{ color: mg.textMuted, fontSize: 14, marginTop: 6 }}>
            <b style={{ color: mg.text }}>{from}</b> зовёт вас играть
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 4 }}>
          <button onClick={dismissInvite} style={{ ...btn('neutral'), flex: 1, padding: '12px 16px' }}>
            Позже
          </button>
          <button
            onClick={() => void goToInvite()}
            disabled={going}
            style={{ ...btn('primary'), flex: 2, padding: '12px 16px', fontWeight: 800, opacity: going ? 0.6 : 1 }}
          >
            {going ? 'Заходим…' : '🎮 Присоединиться'}
          </button>
        </div>
      </div>
    </div>
  );
};
