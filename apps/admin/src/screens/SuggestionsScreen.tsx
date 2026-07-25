import { useEffect, useMemo, useState } from 'react';
import type { Suggestion, SuggestionStatus } from '@mygame/protocol';
import { listSuggestions, updateSuggestionStatus } from '../adminClient.js';
import { useToast } from '../components/ToastProvider.js';

const STATUS_META: Record<SuggestionStatus, { label: string; color: string }> = {
  new: { label: 'Новое', color: 'var(--accent)' },
  accepted: { label: 'Принято', color: 'var(--success)' },
  implemented: { label: 'Реализовано', color: '#7c6cf0' },
  rejected: { label: 'Отклонено', color: 'var(--danger)' },
};
const STATUS_ORDER: SuggestionStatus[] = ['new', 'accepted', 'implemented', 'rejected'];

const fmt = (ms: number): string =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const StatusBadge = ({ status }: { status: SuggestionStatus }): JSX.Element => {
  const m = STATUS_META[status];
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
};

export const SuggestionsScreen = (): JSX.Element => {
  const { showToast } = useToast();
  // null = loading, 'error' = load failed, array = loaded.
  const [items, setItems] = useState<Suggestion[] | null | 'error'>(null);
  const [filter, setFilter] = useState<SuggestionStatus | 'all'>('all');

  const reload = async (): Promise<void> => {
    setItems(null);
    const list = await listSuggestions();
    setItems(list ?? 'error');
  };
  useEffect(() => {
    void reload();
  }, []);

  const setStatus = async (id: string, status: SuggestionStatus): Promise<void> => {
    const updated = await updateSuggestionStatus(id, status);
    if (updated) {
      setItems((prev) => (Array.isArray(prev) ? prev.map((s) => (s.id === id ? updated : s)) : prev));
      showToast('Статус обновлён', 'success');
    } else {
      showToast('Не удалось обновить статус', 'error');
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    if (Array.isArray(items)) for (const s of items) {
      c.all = (c.all ?? 0) + 1;
      c[s.status] = (c[s.status] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const visible = Array.isArray(items) ? (filter === 'all' ? items : items.filter((s) => s.status === filter)) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Предложения</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>Идеи от игроков — двигайте по статусам.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => void reload()}>Обновить</button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['all', ...STATUS_ORDER] as const).map((key) => {
          const active = filter === key;
          const label = key === 'all' ? 'Все' : STATUS_META[key].label;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={active ? 'btn' : 'btn btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {label} {counts[key] ? `(${counts[key]})` : ''}
            </button>
          );
        })}
      </div>

      {items === null ? (
        <div className="glass-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Загрузка…</div>
      ) : items === 'error' ? (
        <div className="glass-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <p style={{ marginBottom: 16 }}>Не удалось загрузить предложения.</p>
          <button className="btn" onClick={() => void reload()}>Повторить</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          {filter === 'all' ? 'Пока нет предложений.' : 'Нет предложений с этим статусом.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((s) => (
            <div key={s.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <StatusBadge status={s.status} />
                  <strong style={{ fontSize: 15 }}>{s.authorName}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{fmt(s.createdAt)}</span>
                </div>
                <select
                  className="input-field"
                  value={s.status}
                  onChange={(e) => void setStatus(s.id, e.target.value as SuggestionStatus)}
                  style={{ width: 180, padding: '6px 10px' }}
                >
                  {STATUS_ORDER.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ color: 'var(--text-main)', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{s.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
