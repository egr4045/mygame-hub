/** Formatting helpers for real playtime/last-played stats, shared by GameDetailsView + ProfileView. */

/** "12 часов", "45 минут", "Ещё не играли" for 0. */
export const formatPlaytime = (secondsPlayed: number): string => {
  if (secondsPlayed <= 0) return 'Ещё не играли';
  const hours = Math.floor(secondsPlayed / 3600);
  if (hours >= 1) return `${hours} ч.`;
  const minutes = Math.max(1, Math.floor(secondsPlayed / 60));
  return `${minutes} мин.`;
};

/** Relative time for a discussion thread's last reply: «только что», «N мин назад», «N ч назад»,
 *  «N дн назад», then a plain date. Null/undefined (no replies yet) → empty string — callers should
 *  hide the «Последний ответ» line entirely for threads with zero replies. */
export const formatLastReply = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '';
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const diffMs = Date.now() - ms;
  if (diffMs < minuteMs) return 'только что';
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)} мин назад`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)} ч назад`;
  if (diffMs < 7 * dayMs) return `${Math.floor(diffMs / dayMs)} дн назад`;
  return new Date(ms).toLocaleDateString('ru-RU');
};

/** "Сегодня" / "Вчера" / "3 дня назад" / a short date further back. Null → "Ещё не играли". */
export const formatLastPlayed = (lastPlayedAt: number | null): string => {
  if (lastPlayedAt === null) return 'Ещё не играли';
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const daysAgo = Math.round((startOfDay(Date.now()) - startOfDay(lastPlayedAt)) / dayMs);
  if (daysAgo <= 0) return 'Сегодня';
  if (daysAgo === 1) return 'Вчера';
  if (daysAgo < 7) return `${daysAgo} дн. назад`;
  return new Date(lastPlayedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
