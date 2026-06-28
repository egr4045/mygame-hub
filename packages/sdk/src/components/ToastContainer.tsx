import { useToastStore, type ToastData } from '../state/toastStore.js';

const ToastItem = ({ toast, onRemove }: { toast: ToastData; onRemove: () => void }) => {
  const isAch = toast.type === 'achievement';
  const isMsg = toast.type === 'message';

  return (
    <div 
      className="civa-fade-in"
      onClick={onRemove}
      style={{
        background: '#1b2838',
        border: `1px solid ${isAch ? '#d4af37' : (isMsg ? '#2AABEE' : '#3d4450')}`,
        boxShadow: `0 4px 12px ${isAch ? 'rgba(212,175,55,0.2)' : 'rgba(0,0,0,0.5)'}`,
        borderRadius: 4,
        padding: '12px 16px',
        width: 300,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Accent strip */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isAch ? '#d4af37' : (isMsg ? '#2AABEE' : '#6c7784') }} />
      
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: isMsg ? '50%' : 4, background: '#23262e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
        {toast.icon || (isAch ? '🏆' : (isMsg ? '💬' : 'ℹ️'))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: isAch ? '#d4af37' : '#dcdedf', marginBottom: 2 }}>{toast.title}</div>
        <div style={{ fontSize: '12px', color: '#8f98a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.content}</div>
      </div>
    </div>
  );
};

export const ToastContainer = (): JSX.Element => {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div style={{
      position: 'fixed',
      right: 24,
      top: 60,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      zIndex: 99999, // Always on top of everything including context menus
      pointerEvents: 'none' // Let clicks pass through if empty
    }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
};
