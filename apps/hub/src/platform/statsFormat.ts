/** Formatting helpers for real playtime/last-played stats, shared by GameDetailsView + ProfileView. */

/** "12 часов", "45 минут", "Ещё не играли" for 0. */
export const formatPlaytime = (secondsPlayed: number): string => {
  if (secondsPlayed <= 0) return 'Ещё не играли';
  const hours = Math.floor(secondsPlayed / 3600);
  if (hours >= 1) return `${hours} ч.`;
  const minutes = Math.max(1, Math.floor(secondsPlayed / 60));
  return `${minutes} мин.`;
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
