/**
 * The one "other player" profile card — used everywhere a profile is opened (the friends sidebar,
 * the chat widget, the mobile Друзья tab). Reads the `mg` theme vars; still self-contained inside
 * an embedded game's overlay because every `mg.*` value carries a baked-in fallback (the stock
 * GAMEHUB look) when no host defines `--mg-*`. Give it a `target` (whatever you have — a friend row, a search hit, a chat
 * peer) and it resolves the live relation/presence from the social store itself, then shows the
 * right actions: message, call, and add / accept / pending / remove depending on your relationship.
 */
import { useEffect } from 'react';
import type { social, TitleAchievementRef } from '@mygame/protocol';
import { useSocialStore } from '../state/socialStore.js';
import { useChatStore } from '../state/chatStore.js';
import { useToastStore } from '../state/toastStore.js';
import { mg, mgZ } from '../theme/tokens.js';
import { btn, surfaceWindow } from '../theme/primitives.js';

/** Whatever the caller happens to know about the person. Presence/activity/title are filled in live
 *  from the friends list when they're a friend, so a stale or sparse `target` still renders correctly. */
export interface ProfileTarget {
  accountId: string;
  displayName: string;
  avatarIcon?: string | null;
  titleAchievement?: TitleAchievementRef | null;
  presence?: social.Presence;
  activity?: social.Activity;
  /** Short friend code, when known (search results carry it) — shown so it can be shared. */
  friendCode?: string | null;
}

const initials = (name: string): string =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Deterministic pleasant colour from a name, so the banner/placeholder isn't a flat grey. */
const avatarBg = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 42%)`;
};

const activityLabel = (presence: social.Presence | undefined, activity: social.Activity | undefined | null): string => {
  if (presence === 'offline') return 'Не в сети';
  if (activity) return `Играет в ${activity.gameName}`;
  if (presence === 'online') return 'В сети';
  return '';
};

const primaryBtn: React.CSSProperties = { ...btn('primary'), padding: '10px' };
const subtleBtn: React.CSSProperties = { ...btn('neutral'), padding: '9px', width: '100%' };

export const UserProfileModal = ({ target, onClose }: { target: ProfileTarget; onClose: () => void }): JSX.Element => {
  const me = useSocialStore((s) => s.me);
  const friends = useSocialStore((s) => s.friends);
  const { addByCode, accept, removeFriend } = useSocialStore.getState();
  const openChatWithUser = useChatStore((s) => s.openChatWithUser);
  const ringUser = useChatStore((s) => s.ringUser);
  const addToast = useToastStore((s) => s.addToast);

  // Prefer the live friend row (fresh presence/activity/avatar/title) over whatever the caller passed.
  const live = friends.find((f) => f.accountId === target.accountId);
  const isSelf = target.accountId === me?.accountId;
  const presence = live?.presence ?? target.presence;
  const activity = live?.activity ?? target.activity ?? null;
  const online = presence === 'online';
  const title = live?.titleAchievement ?? target.titleAchievement ?? null;
  const avatar = live?.avatarIcon ?? target.avatarIcon ?? null;
  const relation: social.SearchRelation = isSelf
    ? 'self'
    : live
      ? live.status === 'accepted'
        ? 'friend'
        : live.status
      : 'none';

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doAdd = (): void =>
    void addByCode(target.accountId).then((ack) =>
      addToast({
        type: 'system',
        title: 'Друзья',
        content: ack.error ?? `Запрос отправлен: ${target.displayName}`,
        icon: ack.error ? '⚠️' : '➕',
      }),
    );

  const friendAction = ((): JSX.Element | null => {
    if (relation === 'self') return null;
    if (relation === 'friend')
      return (
        <button
          onClick={() => {
            removeFriend(target.accountId);
            onClose();
          }}
          style={{ ...btn('danger'), padding: '9px', width: '100%' }}
        >
          🗑️ Удалить из друзей
        </button>
      );
    if (relation === 'outgoing')
      return (
        <button disabled style={{ ...subtleBtn, opacity: 0.6, cursor: 'default' }}>
          ⏳ Заявка отправлена
        </button>
      );
    if (relation === 'incoming')
      return (
        <button
          onClick={() => {
            accept(target.accountId);
            onClose();
          }}
          style={{ ...primaryBtn, width: '100%', background: mg.positive }}
        >
          ✓ Принять заявку в друзья
        </button>
      );
    return (
      <button onClick={doAdd} style={subtleBtn}>
        ➕ Добавить в друзья
      </button>
    );
  })();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: mg.overlay,
        // Above the call window (mgZ.call) — a profile can be opened while a call is up.
        zIndex: mgZ.menu,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...surfaceWindow, width: 300, maxWidth: '100%' }}
      >
        {/* Banner */}
        <div style={{ height: 76, background: `linear-gradient(135deg, ${avatarBg(target.displayName)}, ${mg.surfaceDeep})` }} />
        <div style={{ padding: '0 20px 20px', marginTop: -38, textAlign: 'center' }}>
          <div style={{ display: 'inline-block', position: 'relative', border: `4px solid ${mg.surface}`, borderRadius: '50%' }}>
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                overflow: 'hidden',
                background: avatar ? mg.border : avatarBg(target.displayName),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 30,
              }}
            >
              {avatar ? (
                <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials(target.displayName)
              )}
            </div>
            {presence !== undefined && (
              <span
                style={{
                  position: 'absolute',
                  right: 4,
                  bottom: 4,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: online ? mg.positive : mg.textMuted,
                  border: `3px solid ${mg.surface}`,
                }}
              />
            )}
          </div>

          <div style={{ fontWeight: 700, fontSize: 18, color: mg.text, marginTop: 8, overflowWrap: 'anywhere' }}>
            {target.displayName}
            {isSelf && <span style={{ color: mg.textMuted, fontWeight: 500, fontSize: 13 }}> (вы)</span>}
          </div>
          {activityLabel(presence, activity) && (
            <div style={{ fontSize: 12, color: online ? mg.positive : mg.textMuted, marginTop: 2 }}>
              {activityLabel(presence, activity)}
            </div>
          )}
          {title && (
            <div
              style={{
                display: 'inline-block',
                marginTop: 8,
                fontSize: 12,
                color: mg.achievement,
                background: 'rgba(212,175,55,0.12)',
                border: '1px solid rgba(212,175,55,0.35)',
                borderRadius: mg.rPill,
                padding: '3px 12px',
              }}
            >
              🏅 Есть титульное достижение
            </div>
          )}
          {target.friendCode && (
            <div style={{ fontSize: 12, color: mg.textMuted, marginTop: 8 }}>
              Код друга: <strong style={{ color: mg.text, letterSpacing: 1, fontFamily: 'monospace' }}>{target.friendCode}</strong>
            </div>
          )}

          {!isSelf && (
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => {
                  openChatWithUser(target.accountId, target.displayName);
                  onClose();
                }}
                style={{ ...primaryBtn, flex: 1 }}
              >
                💬 Написать
              </button>
              <button
                onClick={() => {
                  ringUser(target.accountId, target.displayName, 'audio');
                  onClose();
                }}
                title="Позвонить"
                aria-label="Позвонить"
                disabled={presence !== undefined && !online}
                style={{
                  ...btn('neutral'),
                  padding: '9px 14px',
                  fontSize: 15,
                  cursor: presence !== undefined && !online ? 'default' : 'pointer',
                  opacity: presence !== undefined && !online ? 0.5 : 1,
                }}
              >
                📞
              </button>
            </div>
          )}
          {friendAction && <div style={{ marginTop: 8 }}>{friendAction}</div>}
          <button
            onClick={onClose}
            style={{ width: '100%', marginTop: 8, background: 'none', color: mg.textMuted, border: 'none', padding: '6px', fontSize: 13, cursor: 'pointer' }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
