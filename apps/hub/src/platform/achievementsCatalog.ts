/**
 * Display catalog for CIVA's achievements — name/description/icon/color are presentation details the
 * platform's achievements API doesn't (and can't, being cross-game) know about; only the fact that
 * `gameId + achievementId` is unlocked is real (`mygame.achievements.list()`). A game with its own
 * achievements would keep its own such catalog. Hoisted here so ProfileView (the full showcase)
 * renders from one source of truth.
 */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const CIVA_GAME_ID = 'civa';

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'Первая кровь', desc: 'Одержите свою первую победу.', icon: '🏆', color: '#ffd700' },
  { id: 'veteran', name: 'Ветеран', desc: 'Сыграйте 100 матчей.', icon: '⚔', color: '#c0c0c0' },
  { id: 'rich', name: 'Богач', desc: 'Соберите 10 000 золота.', icon: '💰', color: '#ffb347' },
  { id: 'social', name: 'Душа компании', desc: 'Добавьте 10 друзей.', icon: '🤝', color: '#66c0f4' },
  { id: 'night_owl', name: 'Сова', desc: 'Сыграйте матч после полуночи.', icon: '🦉', color: '#a020f0' },
];
