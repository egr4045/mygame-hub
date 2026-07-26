/**
 * Заставка «запускаем игру» на время холодного старта.
 *
 * Игры поднимаются по требованию: оркестратор будит контейнер, и до того, как процесс внутри
 * начнёт слушать порт, шлюз отдаёт 502. Раньше хаб уходил на игру молча и игрок видел голую
 * ошибку сервера. Теперь между кликом и переходом висит эта заставка.
 *
 * Императивный DOM, а не React: переход инициирует общий для десктопа и мобилки модуль
 * enterGameFlow, у которого нет своего места в дереве компонентов. Заставку никто не снимает
 * при успехе — её уносит сама навигация.
 */
const ID = 'mygame-launch-overlay';

export interface LaunchOverlay {
  /** Довести полосу до конца (перед самой навигацией). */
  finish(): void;
  /** Показать ошибку и дать закрыть заставку. */
  fail(message: string): void;
  /** Убрать без следа (например, если переход отменился). */
  dismiss(): void;
}

export function showLaunchOverlay(gameName: string): LaunchOverlay {
  document.getElementById(ID)?.remove();

  const root = document.createElement('div');
  root.id = ID;
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483000',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:22px',
    'background:radial-gradient(ellipse at top,#0e141e 0%,#05080d 60%,#000 100%)',
    'font-family:Inter,system-ui,sans-serif', 'color:#e8eef7',
    'opacity:0', 'transition:opacity .18s ease-out',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:.02em;text-align:center;padding:0 24px';
  title.textContent = `Запускаем «${gameName}»`;

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:13px;color:#8a97ab;text-align:center;padding:0 24px';
  hint.textContent = 'Игра просыпается — это занимает пару секунд';

  const track = document.createElement('div');
  track.style.cssText = 'width:min(320px,70vw);height:6px;border-radius:99px;background:#1b2432;overflow:hidden';
  const bar = document.createElement('div');
  bar.style.cssText = 'height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#22d3ee,#8b5cf6);transition:width .3s ease-out';
  track.appendChild(bar);

  root.append(title, hint, track);
  document.body.appendChild(root);
  requestAnimationFrame(() => { root.style.opacity = '1'; });

  // Реального прогресса у нас нет, поэтому полоса асимптотически подползает к 90% —
  // честнее, чем врать процентами, и видно, что процесс идёт.
  let pct = 0;
  const timer = window.setInterval(() => {
    pct += Math.max(0.6, (90 - pct) * 0.08);
    bar.style.width = `${Math.min(90, pct)}%`;
  }, 200);

  const stop = () => window.clearInterval(timer);
  const remove = () => { stop(); root.remove(); };

  return {
    finish() { stop(); bar.style.width = '100%'; },
    fail(message: string) {
      stop();
      bar.style.background = '#ef4444';
      bar.style.width = '100%';
      title.textContent = 'Не удалось открыть игру';
      hint.textContent = message;
      const btn = document.createElement('button');
      btn.textContent = 'Закрыть';
      btn.style.cssText = 'margin-top:4px;padding:10px 22px;border-radius:10px;border:1px solid #2b3648;background:#141b26;color:#e8eef7;font-weight:700;cursor:pointer';
      btn.onclick = remove;
      root.appendChild(btn);
    },
    dismiss: remove,
  };
}
