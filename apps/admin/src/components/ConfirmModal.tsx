import { type ReactNode } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isBusy?: boolean;
}

export const ConfirmModal = ({
  isOpen,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  isDanger = true,
  onConfirm,
  onCancel,
  isBusy = false,
}: ConfirmModalProps) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--overlay)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    }}>
      <div className="glass-card animate-fade-in" style={{ width: 400, maxWidth: '90%', padding: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>{title}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={isBusy}>
            {cancelText}
          </button>
          <button className={`btn ${isDanger ? 'btn-danger solid' : ''}`} onClick={onConfirm} disabled={isBusy}>
            {isBusy ? 'Подождите...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
