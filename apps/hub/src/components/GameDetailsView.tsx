import { useState } from 'react';
import { type GameInfo } from '../platform/games.js';

export const GameDetailsView = ({ game, onPlay }: { game: GameInfo | null, onPlay: (g: GameInfo) => void }): JSX.Element => {
  const [activeTab, setActiveTab] = useState<'changelog' | 'groups' | 'discussions'>('changelog');
  const [viewDiscussion, setViewDiscussion] = useState<string | null>(null);
  const [isCreatingDiscussion, setIsCreatingDiscussion] = useState(false);

  const resetSubViews = () => {
    setViewDiscussion(null);
    setIsCreatingDiscussion(false);
  };

  if (!game) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1b2838', color: '#6c7784' }}>
        Выберите игру из библиотеки
      </div>
    );
  }

  const playable = game.status === 'playable';

  return (
    <div style={{ flex: 1, background: '#1b2838', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      
      {/* Hero Banner */}
      <div style={{ 
        height: 350, 
        position: 'relative', 
        background: `linear-gradient(to bottom, transparent 0%, #1b2838 100%), linear-gradient(135deg, ${game.accent}44 0%, #1b2838 100%)`,
        display: 'flex',
        alignItems: 'flex-end',
        padding: 40
      }}>
        {/* Fake Logo */}
        <div style={{ fontSize: 72, marginRight: 24, textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.emoji}</div>
        <div>
          <h1 style={{ fontSize: 48, fontWeight: 800, margin: 0, color: '#fff', textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.name}</h1>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ padding: '0 40px', marginTop: -20, display: 'flex', gap: 24, alignItems: 'center', position: 'relative', zIndex: 10 }}>
        
        {playable ? (
          <button 
            onClick={() => onPlay(game)}
            style={{ 
              background: 'linear-gradient(to right, #47bfff 0%, #1a44c2 60%)', 
              border: 'none', 
              borderRadius: 4, 
              padding: '12px 48px', 
              color: '#fff', 
              fontSize: '20px', 
              fontWeight: 600, 
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              transition: 'transform 0.1s'
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            ИГРАТЬ
          </button>
        ) : (
          <button 
            disabled
            style={{ 
              background: '#3d4450', 
              border: 'none', 
              borderRadius: 4, 
              padding: '12px 32px', 
              color: '#6c7784', 
              fontSize: '20px', 
              fontWeight: 600, 
            }}
          >
            СКОРО ВЫЙДЕТ
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: '#8f98a0', textTransform: 'uppercase' }}>ПОСЛЕДНИЙ ЗАПУСК</div>
          <div style={{ fontSize: '13px', color: '#dcdedf' }}>Сегодня</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: '#8f98a0', textTransform: 'uppercase' }}>ВРЕМЯ В ИГРЕ</div>
          <div style={{ fontSize: '13px', color: '#dcdedf' }}>12 часов</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 32, padding: '24px 40px 0 40px', borderBottom: '1px solid #2a3f5a' }}>
        {[
          { id: 'changelog', label: 'Ченжлог' },
          { id: 'groups', label: 'Найти группы' },
          { id: 'discussions', label: 'Обсуждения' }
        ].map((tab) => (
          <div 
            key={tab.id} 
            onClick={() => {
              setActiveTab(tab.id as any);
              resetSubViews();
            }}
            style={{ 
              fontSize: '13px', 
              color: activeTab === tab.id ? '#fff' : '#8f98a0', 
              paddingBottom: 8, 
              borderBottom: activeTab === tab.id ? '3px solid #66c0f4' : '3px solid transparent', 
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* Content Body */}
      <div style={{ padding: 40, display: 'flex', gap: 40, flex: 1, flexDirection: 'column' }}>
        
        {activeTab === 'changelog' && (
          <div style={{ display: 'flex', gap: 40 }}>
            <div style={{ flex: 2 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: 16 }}>АКТИВНОСТЬ И ОБНОВЛЕНИЯ</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, borderLeft: '4px solid #66c0f4' }}>
                  <div style={{ color: '#66c0f4', fontWeight: 700, marginBottom: 8, fontSize: '18px' }}>Патч 1.0.3: Исправление баланса</div>
                  <div style={{ color: '#8f98a0', fontSize: '12px', marginBottom: 16 }}>Опубликовано 12 мая 2026</div>
                  <ul style={{ color: '#dcdedf', fontSize: '14px', margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                    <li>Улучшена стабильность серверов при большом онлайне.</li>
                    <li>Исправлен баг с пропадающими текстурами в главном меню.</li>
                    <li>Слегка ослаблен класс "Маг" в соревновательном режиме.</li>
                  </ul>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, borderLeft: '4px solid #3d4450' }}>
                  <div style={{ color: '#fff', fontWeight: 700, marginBottom: 8, fontSize: '18px' }}>Крупное обновление: Новый сезон</div>
                  <div style={{ color: '#8f98a0', fontSize: '12px', marginBottom: 16 }}>Опубликовано 1 мая 2026</div>
                  <p style={{ color: '#dcdedf', fontSize: '14px', margin: 0, lineHeight: 1.6 }}>
                    Добро пожаловать в новый сезон! Мы добавили 5 новых карт, новую систему рангов и множество косметических предметов. Заходите в игру и получайте бесплатный сундук.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: 16 }}>ДОСТИЖЕНИЯ</h2>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, color: '#8f98a0', fontSize: '13px' }}>
                Достижения пока недоступны.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>АКТИВНЫЕ ЛОББИ</h2>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, border: '1px solid #3d4450', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>Ищем +1 в рейтинг</div>
                <div style={{ color: '#8f98a0', fontSize: '12px', marginTop: 4 }}>Хост: S1mple • 3/4 игроков</div>
              </div>
              <button style={{ background: '#5c7e10', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Присоединиться</button>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, border: '1px solid #3d4450', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>Новички, учимся играть</div>
                <div style={{ color: '#8f98a0', fontSize: '12px', marginTop: 4 }}>Хост: NoobMaster69 • 1/4 игроков</div>
              </div>
              <button style={{ background: '#5c7e10', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Присоединиться</button>
            </div>
            <button style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '12px', borderRadius: 4, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start', marginTop: 16 }}>+ Создать лобби</button>
          </div>
        )}

        {activeTab === 'discussions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* View Single Discussion */}
            {viewDiscussion === '1' && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button onClick={() => setViewDiscussion(null)} style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>← Назад</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>Как пройти уровень 4? Постоянно не хватает ресурсов</h2>
                </div>
                
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 4, border: '1px solid #3d4450' }}>
                  <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid #3d4450', paddingBottom: 16, marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, background: '#66c0f4', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: '#fff' }}>P</div>
                    <div>
                      <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px' }}>ProGamer</div>
                      <div style={{ color: '#8f98a0', fontSize: '12px' }}>Опубликовано 5 мин назад</div>
                    </div>
                  </div>
                  <div style={{ color: '#dcdedf', fontSize: '15px', lineHeight: 1.6 }}>
                    Ребята, привет. Застрял на 4 уровне. К середине волны у меня полностью кончается золото и мана, а босс пробивает защиту за два удара. Есть какие-то тактики или я просто неправильно качаю ветку защиты? Помогите советом!
                  </div>
                </div>

                <div style={{ paddingLeft: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, borderLeft: '2px solid #5c7e10' }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: 8 }}>S1mple <span style={{ color: '#8f98a0', fontSize: '12px', fontWeight: 400 }}>• 2 мин назад</span></div>
                    <div style={{ color: '#dcdedf', fontSize: '14px' }}>Попробуй не строить вышки 3 тира до 10 волны. Лучше спамь дешёвыми лучниками, они справятся с мелочью, а золото копи на апгрейд главного здания.</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, borderLeft: '2px solid #5c7e10' }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: 8 }}>NoobMaster69 <span style={{ color: '#8f98a0', fontSize: '12px', fontWeight: 400 }}>• только что</span></div>
                    <div style={{ color: '#dcdedf', fontSize: '14px' }}>Жиза, тоже там застрял. Буду пробовать тактику выше.</div>
                  </div>
                </div>

                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <textarea placeholder="Написать комментарий..." style={{ width: '100%', height: 100, background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: 12, color: '#fff', resize: 'vertical' }} />
                  <button style={{ alignSelf: 'flex-end', background: '#1a9fff', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Отправить</button>
                </div>
              </div>
            )}

            {/* Create Discussion */}
            {isCreatingDiscussion && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button onClick={() => setIsCreatingDiscussion(false)} style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>← Отмена</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>Создать новую тему</h2>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <input placeholder="Заголовок темы (например: Как пройти уровень 4?)" style={{ width: '100%', background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: '12px 16px', color: '#fff', fontSize: '16px', outline: 'none' }} />
                  <textarea placeholder="Опишите вашу проблему, идею или вопрос в деталях..." style={{ width: '100%', height: 200, background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: '12px 16px', color: '#fff', fontSize: '15px', resize: 'vertical', outline: 'none' }} />
                  
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
                    <button style={{ background: '#5c7e10', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: '16px' }}>Опубликовать</button>
                  </div>
                </div>
              </div>
            )}

            {/* Discussions List */}
            {!viewDiscussion && !isCreatingDiscussion && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>ОБСУЖДЕНИЯ</h2>
                  <button onClick={() => setIsCreatingDiscussion(true)} style={{ background: '#1a9fff', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Новая тема</button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div onClick={() => setViewDiscussion('1')} style={{ background: 'rgba(0,0,0,0.3)', padding: '16px 24px', borderRadius: 4, borderLeft: '4px solid #1a9fff', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.3)'}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px', marginBottom: 8 }}>Как пройти уровень 4? Постоянно не хватает ресурсов</div>
                    <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: '#8f98a0' }}>
                      <span>Автор: ProGamer</span>
                      <span>💬 12 ответов</span>
                      <span>Последний ответ: 5 мин назад</span>
                    </div>
                  </div>
                  
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px 24px', borderRadius: 4, borderLeft: '4px solid #3d4450', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.3)'}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px', marginBottom: 8 }}>Баг с текстурами в главном меню</div>
                    <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: '#8f98a0' }}>
                      <span>Автор: egr4045</span>
                      <span>💬 3 ответа</span>
                      <span>Последний ответ: 2 часа назад</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px 24px', borderRadius: 4, borderLeft: '4px solid #3d4450', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.3)'}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px', marginBottom: 8 }}>Ищу пати для турнира на выходных</div>
                    <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: '#8f98a0' }}>
                      <span>Автор: CyberCat</span>
                      <span>💬 0 ответов</span>
                      <span>Последний ответ: 5 часов назад</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

      </div>
      
    </div>
  );
};
