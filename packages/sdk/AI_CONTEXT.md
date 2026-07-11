# @mygame/sdk — контекст для AI-разработки игр

Этот файл — самодостаточный контекст. Скопируй его целиком (или прикрепи файлом) в диалог с
другой нейросетью вместе с задачей ниже, чтобы она могла писать игру на базе `@mygame/sdk`, не имея
доступа к остальному репозиторию.

## Задача (отредактируй под свою игру)

```
Напиши полноценную играбельную браузерную игру (React + TypeScript), которая использует ВСЕ
возможности @mygame/sdk, описанные в этом документе: аутентификацию, достижения, профиль,
статистику/время в игре, социальные функции (друзья, presence, лобби), чат (личные сообщения,
группы, звонки), ченджлог и обсуждения. Жанр/идея игры: _______________ (впиши сюда).
Используй @mygame/sdk именно так, как показано в разделе "Полный пример" ниже — это рабочий,
проверенный код из этого же репозитория, а не выдуманный API.
```

---

## Что это такое

GAMEHUB — игровая платформа: один "хаб" (лаунчер) + набор независимых игр, каждая — отдельное
SPA-приложение (свой Vite-проект, свой origin или путь), которое встраивает `@mygame/sdk`. SDK даёт
игре: общий аккаунт игрока, друзей и presence, чат с личными и групповыми звонками, достижения,
статистику по времени игры, ченджлог/обсуждения и системный оверлей (тосты, контекстное меню, чат),
который монтируется поверх игры сам.

Все игры одной платформы используют **один и тот же аккаунт** — залогинился один раз в хабе, и в
любой игре, куда он перешёл, автоматически продолжает быть тем же пользователем (см. раздел
"SSO / переход между играми" ниже).

SDK — обычный npm-пакет (`@mygame/sdk`, пока приватный внутри монорепо, готовится к
опенсорсу). Зависимости: `react`/`react-dom` (peer), `zustand`, `socket.io-client`,
`livekit-client`. Никакого роутера или UI-фреймворка не требуется — компоненты оверлея верстаются
инлайн-стилями и рендерятся в изолированный Shadow DOM, так что не конфликтуют с CSS самой игры.

## Быстрый старт

```ts
import { mygame } from '@mygame/sdk';

// После того как у игрока есть сессия (см. "Аутентификация" ниже):
mygame.init('my-game-id', {
  // Опционально — если игра развёрнута не на одном origin с хабом.
  // hubUrl: 'https://mygame-quiz.ru',
});
```

`mygame.init(gameId, opts)`:
- монтирует системный оверлей (тосты + контекстное меню + чат/друзья) в изолированный Shadow DOM;
- подключает соцстор (presence/друзья) и чат-стор (сокеты);
- фиксирует запуск игры (`last_played_at`) и запускает heartbeat статистики игрового времени
  (~каждые 30с, пока вкладка видима);
- идемпотентен — повторный вызов не переинициализирует сокеты заново.

## Конфигурация (`mygame.init`'s `opts` / `configure()`)

```ts
export interface ConfigureOptions {
  hubUrl?: string;       // задаёт auth/social/chat/community/orchestrator разом
  authUrl?: string;
  socialUrl?: string;
  chatUrl?: string;
  communityUrl?: string;
  orchestratorUrl?: string;
}
```

По умолчанию (без `hubUrl`): в dev — локальные порты каждого сервиса (`localhost:8081` и т.д.), в
проде — тот же origin, на котором открыта страница (хаб раздаёт все сервисы через reverse-proxy
путями `/auth/*`, `/community/*` и т.д. на одном домене). Игру, развёрнутую на своём отдельном
origin, нужно явно указать через `hubUrl`.

## Аутентификация

**Важно: аутентификация парольная**, не passwordless. Регистрация создаёт новый аккаунт; логин —
только для уже существующего.

```ts
mygame.auth.register(displayName: string, password: string): Promise<Session>
mygame.auth.login(displayName: string, password: string): Promise<Session>
mygame.auth.getAccount(): { accountId: string; displayName: string } | null
mygame.auth.getToken(): string | null            // текущий access-токен из localStorage
mygame.auth.logout(): void
```

`Session` = `{ accountId, displayName, accessToken, refreshToken }`, сохраняется в
`localStorage` и переживает перезагрузку страницы. `register`/`login` бросают исключение при
ошибке (занято имя / неверный пароль) — оборачивай в try/catch.

### SSO / переход между играми (`?pt=` handoff)

Когда хаб открывает игру, он может передать токен-пропуск через URL: `https://game/?pt=<token>`.
Игра должна на старте проверить этот параметр и обменять токен на полноценную сессию — **без**
пароля, сервер сам проверяет подпись токена:

```ts
mygame.auth.loginWithToken(handoffToken: string): Promise<Session | null>
```

Возвращает `null`, если токен просрочен/невалиден — тогда просто показывай обычную форму
логина/регистрации. Полный пример — в разделе "Полный пример" ниже (эффект на `pt=`).

## Достижения

```ts
mygame.achievements.grant(achievementId: string): Promise<boolean>  // true если это новая разблокировка
mygame.achievements.list(): Promise<Achievement[]>
```

`achievementId` — произвольная строка, которую придумывает сама игра (без каталога/валидации на
сервере — доверительная модель: клиент сам сообщает о разблокировке). Идемпотентно: повторный
`grant` того же id вернёт `false`, но не создаст дубликат. При новой разблокировке SDK сам
показывает тост — ничего дополнительно вызывать не нужно.

```ts
interface Achievement { gameId: string; achievementId: string; unlockedAt: number /* epoch ms */ }
```

## Профиль (аватар/обои/титул — общие для всех игр)

```ts
mygame.profile.get(): Promise<ProfileResponse | null>
mygame.profile.setAvatar(dataUrl: string): Promise<string | null>       // dataUrl из FileReader.readAsDataURL
mygame.profile.setWallpaper(dataUrl: string): Promise<string | null>
mygame.profile.setTitle(ref: { gameId: string; achievementId: string } | null): Promise<boolean>
```

`setTitle` отклоняется сервером, если аккаунт не разблокировал указанное достижение.

## Статистика / время в игре

Запуск (`last_played_at`) и heartbeat (~каждые 30с, пока вкладка видима) уже включены в
`mygame.init()` — ничего вызывать не нужно. Ручное управление, если требуется:

```ts
mygame.stats.recordEnter(): Promise<boolean>
mygame.stats.getStats(): Promise<GameStat[]>
mygame.stats.startHeartbeat(): void
mygame.stats.stopHeartbeat(): void
```

```ts
interface GameStat { gameId: string; secondsPlayed: number; lastPlayedAt: number | null }
```

Время сервер считает сам (клиент никогда не отправляет длительность — только heartbeat-сигналы).

## Соцфункции: друзья, presence, лобби

```ts
mygame.social.connect(): Promise<void>       // уже вызывается из mygame.init()
mygame.social.disconnect(): void
mygame.social.getMe(): { accountId, displayName, avatarIcon, titleAchievement, ... } | null
mygame.social.getFriends(): Friend[]
mygame.social.addByCode(code: string): void  // отправить заявку в друзья по accountId
mygame.social.setActivity(activity: Activity): void
mygame.social.getLobbies(gameId?: string): Promise<Lobby[]>   // открытые лобби друзей в этой игре
mygame.social.subscribe(cb: () => void): () => void            // подписка на изменения (возвращает unsubscribe)
```

```ts
interface Activity { game: string; gameName: string; room: string | null; joinable: boolean }
interface Friend {
  accountId: string; displayName: string;
  avatarIcon: string | null; titleAchievement: { gameId: string; achievementId: string } | null;
  status: 'accepted' | 'incoming' | 'outgoing';
  presence: 'online' | 'offline';
  activity: Activity | null;
}
```

`setActivity` — то, что показывает друзьям "играет в X, комната Y" и включает кнопку
"присоединиться" в хабе, если `joinable: true`. Вызывай при входе/выходе из комнаты/матча.

Виджет друзей (`FriendsWidget`/`FriendsSidebar`) монтируется сам как часть системного оверлея —
отдельно вызывать не нужно, если не собираешь свой собственный UI поверх стора.

## Чат: личные сообщения, группы, звонки

```ts
mygame.chat.open(): void
mygame.chat.openWithUser(userId: string, userName: string): void
mygame.chat.createGroup(name: string, memberIds: string[]): void
mygame.chat.addMembers(conversationId: string, memberIds: string[]): void
mygame.chat.removeMember(conversationId: string, accountId: string): void  // себя — всегда; чужого — только владелец группы
mygame.chat.leaveGroup(conversationId: string): void
mygame.chat.send(conversationId: string, text: string): void
mygame.chat.getThreads(): ChatSession[]
mygame.chat.getUnreadCount(): number
mygame.chat.subscribe(cb: () => void): () => void
```

Готовый виджет чата (`ChatWidget`) уже включает: личные и групповые диалоги, управление
участниками группы (добавить/убрать/выйти, кик — только у владельца), список участников с
контекстным меню (профиль/добавить в друзья/заблокировать), и **настоящие аудио/видео звонки**
через встроенный LiveKit (входящий вызов — тост со звонком, принять/отклонить/завершить,
переключение микрофона/камеры). Всё это монтируется само через оверлей — `mygame.chat.open()`
просто открывает уже смонтированный виджет.

## Ченджлог и обсуждения (community)

```ts
mygame.community.getChangelog(gameId?: string): Promise<ChangelogEntry[]>   // по умолчанию — текущая игра
mygame.community.getThreads(gameId?: string): Promise<DiscussionThread[]>
mygame.community.getThread(threadId: string, gameId?: string): Promise<{ thread; posts } | null>
mygame.community.createThread(title: string, body: string, gameId?: string): Promise<DiscussionThread | null>
mygame.community.createPost(threadId: string, body: string): Promise<DiscussionPost | null>
```

Чтение — публичное (без токена). Публикация ченджлога требует прав администратора платформы
(`is_admin`) — обычная игра сама патчноуты не публикует, только читает. Создание темы/поста в
обсуждениях требует только валидной сессии — модерации на уровне игры пока нет.

```ts
interface ChangelogEntry { id, gameId, version, title, body, publishedAt: number }
interface DiscussionThread { id, gameId, authorId, authorName, title, createdAt, replyCount, lastReplyAt }
interface DiscussionPost { id, threadId, authorId, authorName, body, createdAt }
```

## UI-хелперы

```ts
mygame.ui.showContextMenu(opts: { x: number; y: number; items: MenuItem[] }): void
mygame.ui.closeMenu(): void
mygame.ui.toast(toast: { type; title; content?; icon? }): void
```

## События

```ts
mygame.on('ready', ({ gameId }) => { /* mygame.init() завершил инициализацию */ }): () => void  // возвращает unsubscribe
```

---

## Полный пример (рабочий код из репозитория — `apps/example-game/src/App.tsx`)

Это не выдуманный пример — реальный, протестированный референс, который используют для проверки
самого SDK. Показывает: пароль-логин/регистрацию, SSO-переход по `?pt=`, `mygame.init`,
достижения, presence/лобби, чат, статистику, ченджлог, обсуждения.

```tsx
import { useEffect, useState } from 'react';
import { mygame, type MygameAccount } from '@mygame/sdk';
import type { ChangelogEntry, DiscussionThread, GameStat } from '@mygame/protocol';

const GAME_ID = 'example-game';

/** Whether the URL carries an unconsumed handoff token right now (checked once, before it's stripped). */
const hasPendingHandoff = (): boolean =>
  typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('pt');

export const App = (): JSX.Element => {
  const [account, setAccount] = useState<MygameAccount | null>(() => (hasPendingHandoff() ? null : mygame.auth.getAccount()));
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [joinable, setJoinable] = useState(false);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [threads, setThreads] = useState<DiscussionThread[]>([]);

  // Handoff from the hub (`?pt=<token>`): redeem it for a session on this origin as the same
  // platform account (the auth service verifies the token itself), then strip it from the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const pt = url.searchParams.get('pt');
    if (!pt) return;
    url.searchParams.delete('pt');
    window.history.replaceState({}, '', url.toString());
    void mygame.auth.loginWithToken(pt).then((session) => {
      if (session) setAccount(mygame.auth.getAccount());
    });
  }, []);

  // Bootstrap the SDK once we have an account.
  useEffect(() => {
    if (!account || initialized) return;
    mygame.init(GAME_ID, {});
    setInitialized(true);
  }, [account, initialized]);

  useEffect(() => {
    if (!initialized) return;
    void mygame.stats.getStats().then(setStats);
    void mygame.community.getChangelog().then(setChangelog);
    void mygame.community.getThreads().then(setThreads);
    mygame.social.setActivity({ game: GAME_ID, gameName: 'Example Game', room: null, joinable: false });
  }, [initialized]);

  const handleLogin = async (): Promise<void> => {
    if (!displayNameInput.trim() || !passwordInput) return;
    setAuthError(null);
    try {
      await mygame.auth.login(displayNameInput.trim(), passwordInput);
      setAccount(mygame.auth.getAccount());
    } catch {
      setAuthError('Неверный логин или пароль');
    }
  };

  const handleRegister = async (): Promise<void> => {
    if (!displayNameInput.trim() || !passwordInput) return;
    setAuthError(null);
    try {
      await mygame.auth.register(displayNameInput.trim(), passwordInput);
      setAccount(mygame.auth.getAccount());
    } catch {
      setAuthError('Имя уже занято или ошибка регистрации');
    }
  };

  const handleWin = async (): Promise<void> => {
    await mygame.achievements.grant('first_win'); // idempotent; SDK shows the unlock toast itself
    setStats(await mygame.stats.getStats());
  };

  const toggleJoinable = (next: boolean): void => {
    setJoinable(next);
    mygame.social.setActivity({ game: GAME_ID, gameName: 'Example Game', room: next ? 'demo-room' : null, joinable: next });
  };

  if (!account) {
    return (
      <div>
        <input placeholder="Ваше имя" value={displayNameInput} onChange={(e) => setDisplayNameInput(e.target.value)} />
        <input type="password" placeholder="Пароль" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
        {authError && <p>{authError}</p>}
        <button onClick={() => void handleLogin()}>Войти</button>
        <button onClick={() => void handleRegister()}>Регистрация</button>
      </div>
    );
  }

  const myStat = stats.find((s) => s.gameId === GAME_ID);

  return (
    <div>
      <h1>Example Game — {account.displayName}</h1>
      <button onClick={() => void handleWin()}>🏆 Одержать победу</button>

      <label>
        <input type="checkbox" checked={joinable} onChange={(e) => toggleJoinable(e.target.checked)} />
        Открыто для друзей
      </label>

      <button onClick={() => mygame.chat.open()}>💬 Открыть чат</button>

      <div>Время в игре: {myStat?.secondsPlayed ?? 0} сек</div>

      <div>
        {changelog.map((e) => <div key={e.id}>{e.version}: {e.title}</div>)}
      </div>
      <div>
        {threads.map((t) => <div key={t.id}>{t.title} · {t.replyCount} ответ(ов)</div>)}
      </div>
    </div>
  );
};
```

```tsx
// main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

---

## Известные ограничения (не выдумывай решений — так есть на самом деле)

- Достижения не валидируются сервером — клиент сам сообщает о разблокировке (доверительная модель).
- Нет каталога метаданных ачивок (название/иконка/описание) — только `gameId` + `achievementId`,
  придуманные самой игрой.
- Нет сброса пароля ("забыли пароль").
- Нет лидербордов/агрегированной статистики между игроками — только собственная статистика игрока.
- Обсуждения не модерируются на уровне игры (только на уровне платформы, отдельным админ-панелью).

## Технические детали (если нужно копать глубже)

- Сокеты: friends/presence на пути `/social.io/`, чат на `/chat.io/` (не дефолтный `/socket.io/` —
  тот зарезервирован под лобби конкретной игры).
- Аккаунт хранится в `localStorage` под ключом `civa.session` (историческое имя, платформа
  переименована в GAMEHUB, ключ не менялся, чтобы не инвалидировать существующие сессии).
- SDK не содержит роутера и не навязывает UI-библиотеку — компоненты оверлея просто React с
  инлайн-стилями в Shadow DOM; сама игра может использовать что угодно для своего интерфейса.
