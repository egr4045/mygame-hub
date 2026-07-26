/**
 * Разбудить игру перед переходом на неё.
 *
 * Игры живут по требованию: оркестратор поднимает контейнер и гасит простаивающий. Если уйти
 * на игру, не разбудив её, шлюз отдаёт 502 — именно так вёл себя переход по приглашению в звонке.
 * Эндпоинт всегда на нашем же origin (шлюз проксирует `/orchestrator/*`), поэтому хватает
 * относительного пути и SDK не нужно знать адрес хаба.
 *
 * Обе функции «мягкие»: в дев-окружении оркестратора нет, и это не повод не пускать игрока.
 */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 400;

export async function wakeGame(gameId: string): Promise<void> {
  try {
    await fetch(`/orchestrator/games/${encodeURIComponent(gameId)}/enter`, {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // оркестратора нет или он не ответил — дальше решает проверка готовности
  }
}

/** Ждёт, пока по адресу игры перестанут отдавать ошибку. Кросс-ориджин не проверяем:
 *  CORS всё равно скроет статус, там полагаемся на оркестратор. */
export async function waitGameReady(url: string, timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
  let target: URL;
  try { target = new URL(url, window.location.href); } catch { return true; }
  if (target.origin !== window.location.origin) return true;

  const root = `${target.origin}${target.pathname}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(root, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return true;
    } catch { /* сеть моргнула */ }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
}
