import { useToastStore, type ToastData } from '../state/toastStore.js';

const accentFor = (t: ToastData['type']): string =>
  t === 'achievement' ? '#d4af37' : t === 'invite' ? '#3ba55d' : t === 'message' ? '#2AABEE' : '#6c7784';

const ToastItem = ({ toast, onRemove }: { toast: ToastData; onRemove: () => void }): JSX.Element => {
  const accent = accentFor(toast.type);
  const clickable = !!toast.onClick;
  return (
    <div
      className="civa-fade-in"
      onClick={
        clickable
          ? () => {
              toast.onClick?.();
              onRemove();
            }
          : undefined
      }
      style={{
        background: '#1b2838',
        border: `1px solid ${toast.type === 'achievement' ? '#d4af37' : toast.type === 'invite' ? '#3ba55d' : toast.type === 'message' ? '#2AABEE' : '#3d4450'}`,
        boxShadow: `0 6px 20px rgba(0,0,0,0.55)`,
        borderRadius: 6,
        padding: '12px 14px 12px 16px',
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />

      <div
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: toast.type === 'invite' || toast.type === 'achievement' ? 8 : '50%',
          background: '#23262e',
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
        <div style={{ fontSize: 13, fontWeight: 700, color: toast.type === 'achievement' ? '#d4af37' : '#dcdedf', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: 12, color: '#b8c2cc', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
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
                style={{
                  border: 'none',
                  borderRadius: 5,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: a.primary ? accent : '#3d4450',
                  color: '#fff',
                }}
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
        style={{ background: 'none', border: 'none', color: '#6c7784', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
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
        bottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 99999, // above everything, including context menus
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
