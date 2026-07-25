import { useToastStore, type ToastData } from '../state/toastStore.js';
import { mg, mgZ } from '../theme/tokens.js';
import { btn, surfaceWindow } from '../theme/primitives.js';

const accentFor = (t: ToastData['type']): string =>
  t === 'achievement' ? mg.achievement : t === 'invite' ? mg.positive : t === 'message' ? mg.accent : mg.textMuted;

const ToastItem = ({ toast, onRemove }: { toast: ToastData; onRemove: () => void }): JSX.Element => {
  const accent = accentFor(toast.type);
  const clickable = !!toast.onClick;
  return (
    <div
      className="mygame-fade-in"
      onClick={
        clickable
          ? () => {
              toast.onClick?.();
              onRemove();
            }
          : undefined
      }
      style={{
        ...surfaceWindow,
        border: `1px solid ${toast.type === 'achievement' ? mg.achievement : toast.type === 'invite' ? mg.positive : toast.type === 'message' ? mg.accent : mg.border}`,
        boxShadow: mg.shadowPopover,
        borderRadius: mg.rMd,
        padding: '12px 14px 12px 16px',
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />

      <div
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: toast.type === 'invite' || toast.type === 'achievement' ? mg.rMd : '50%',
          background: mg.surfaceRaised,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
        }}
      >
        {toast.avatar ? (
          <img src={toast.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          toast.icon || (toast.type === 'achievement' ? '🏆' : toast.type === 'invite' ? '🎮' : toast.type === 'message' ? '💬' : 'ℹ️')
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: toast.type === 'achievement' ? mg.achievement : mg.text, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: 12, color: mg.textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
          {toast.content}
        </div>
        {toast.actions && toast.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {toast.actions.map((a, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onClick();
                  onRemove();
                }}
                style={a.primary ? { ...btn('primary'), background: accent } : btn('ghost')}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Закрыть"
        style={{ background: 'none', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
};

/** Steam-style notifications, bottom-right, newest at the bottom. */
export const ToastContainer = (): JSX.Element => {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: mgZ.toast, // above everything, including context menus
        pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
};
