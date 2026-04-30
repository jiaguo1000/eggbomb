import React, { useState, useEffect } from 'react';
import { SOCKET_EVENTS } from '@eggbomb/shared';
import socket from '../socket';
import { useCompact } from '../hooks/useCompact';

interface LobbyPageProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
}

interface FloatingCardProps {
  suit: '♠' | '♥' | '♦' | '♣';
  rank: string;
  pos: React.CSSProperties;
  anim: string;
  size?: number;
  delay?: number;
  opacity?: number;
}

const FloatingCard: React.FC<FloatingCardProps> = ({ suit, rank, pos, anim, size = 90, delay = 0, opacity = 0.85 }) => {
  const isRed = suit === '♥' || suit === '♦';
  const w = size;
  const h = Math.round(size * 1.4);
  return (
    <div
      style={{
        position: 'absolute',
        width: `${w}px`,
        height: `${h}px`,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        animation: `${anim} 18s ease-in-out ${delay}s infinite`,
        pointerEvents: 'none',
        opacity,
        ...pos,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '10px',
          color: isRed ? '#ff8a80' : '#eceff1',
          fontSize: `${Math.round(size * 0.18)}px`,
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: 'left',
        }}
      >
        {rank}
        <div style={{ fontSize: `${Math.round(size * 0.22)}px`, marginTop: '1px' }}>{suit}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '10px',
          color: isRed ? '#ff8a80' : '#eceff1',
          fontSize: `${Math.round(size * 0.18)}px`,
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: 'right',
          transform: 'rotate(180deg)',
        }}
      >
        {rank}
        <div style={{ fontSize: `${Math.round(size * 0.22)}px`, marginTop: '1px' }}>{suit}</div>
      </div>
    </div>
  );
};

const KEYFRAMES = `
@keyframes lobbyDrift1 {
  0%, 100% { transform: translate(0, 0) rotate(-12deg); }
  50% { transform: translate(14px, -12px) rotate(-9deg); }
}
@keyframes lobbyDrift2 {
  0%, 100% { transform: translate(0, 0) rotate(8deg); }
  50% { transform: translate(-12px, 14px) rotate(11deg); }
}
@keyframes lobbyDrift3 {
  0%, 100% { transform: translate(0, 0) rotate(-5deg); }
  50% { transform: translate(12px, -14px) rotate(-2deg); }
}
@keyframes lobbyDrift4 {
  0%, 100% { transform: translate(0, 0) rotate(15deg); }
  50% { transform: translate(-14px, 10px) rotate(12deg); }
}
@keyframes lobbyFadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.lobby-title {
  background: linear-gradient(135deg, #fff5cc 0%, #ffd700 40%, #ffa726 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 18px rgba(255,215,0,0.35));
}
.lobby-fade-1 { animation: lobbyFadeUp 0.6s ease-out 0.05s both; }
.lobby-fade-2 { animation: lobbyFadeUp 0.6s ease-out 0.18s both; }
.lobby-fade-3 { animation: lobbyFadeUp 0.6s ease-out 0.32s both; }
.lobby-input:focus { border-color: rgba(255,215,0,0.55) !important; box-shadow: 0 0 0 3px rgba(255,215,0,0.12) !important; }
.lobby-tab { transition: all 0.2s ease; }
.lobby-tab:hover { color: #ddd; background: rgba(255,255,255,0.04); }
.lobby-tab-active { background: rgba(255,215,0,0.16) !important; color: #ffd700 !important; box-shadow: 0 0 0 1px rgba(255,215,0,0.25); }
.lobby-primary-btn { transition: transform 0.15s ease, box-shadow 0.2s ease, filter 0.2s ease; }
.lobby-primary-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(255,179,0,0.35); filter: brightness(1.05); }
.lobby-primary-btn:active { transform: translateY(0); filter: brightness(0.95); }
@media (prefers-reduced-motion: reduce) {
  [class^="lobby-fade-"] { animation: none !important; }
  [style*="lobbyDrift"] { animation: none !important; }
}
`;

const LobbyPage: React.FC<LobbyPageProps> = ({ playerName, onPlayerNameChange }) => {
  const compact = useCompact();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [stats, setStats] = useState<{ roomCount: number; playerCount: number; maxRooms: number } | null>(null);

  useEffect(() => {
    const base = import.meta.env.VITE_SERVER_URL ?? '';
    fetch(`${base}/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const handleCreateRoom = () => {
    const name = playerName.trim();
    if (!name) {
      alert('请先输入你的名字');
      return;
    }
    socket.emit(SOCKET_EVENTS.CREATE_ROOM, { playerName: name });
  };

  const handleJoinRoom = () => {
    const name = playerName.trim();
    const code = roomCodeInput.trim().toUpperCase();
    if (!name) {
      alert('请先输入你的名字');
      return;
    }
    if (!code) {
      alert('请输入房间号');
      return;
    }
    socket.emit(SOCKET_EVENTS.JOIN_ROOM, { roomCode: code, playerName: name });
  };

  const cardSize = compact ? 70 : 95;

  return (
    <div style={{ ...styles.container, ...(compact ? { padding: '0.5rem', alignItems: 'center' } : {}) }}>
      <style>{KEYFRAMES}</style>

      {/* Gradient mesh background */}
      <div style={styles.bgMesh} />

      {/* Floating A cards — 4 suits, on both desktop and compact */}
      <FloatingCard suit="♠" rank="A" pos={compact ? { top: '6%', left: '4%' } : { top: '8%', left: '6%' }} anim="lobbyDrift1" size={cardSize} />
      <FloatingCard suit="♥" rank="A" pos={compact ? { top: '6%', right: '4%' } : { top: '14%', right: '8%' }} anim="lobbyDrift2" size={cardSize} />
      <FloatingCard suit="♦" rank="A" pos={compact ? { bottom: '6%', left: '4%' } : { bottom: '14%', left: '8%' }} anim="lobbyDrift3" size={cardSize} />
      <FloatingCard suit="♣" rank="A" pos={compact ? { bottom: '6%', right: '4%' } : { bottom: '10%', right: '7%' }} anim="lobbyDrift4" size={cardSize} />

      <div
        className="lobby-fade-2"
        style={{
          ...styles.card,
          ...(compact ? { flexDirection: 'row', padding: '0.75rem 1rem', gap: '1rem', maxWidth: '560px' } : {}),
          position: 'relative',
          zIndex: 2,
        }}
      >

        {/* Left column in compact: title + name input */}
        <div style={compact ? { display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, justifyContent: 'center' } : { display: 'contents' }}>
          {/* Title */}
          <div className="lobby-fade-1" style={{ ...styles.titleSection, ...(compact ? { marginBottom: 0 } : {}) }}>
            {compact ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <img src="/bomb-logo.png" alt="" style={styles.logoCompact} />
                <h1 className="lobby-title" style={{ ...styles.title, fontSize: '2.2rem' }}>掼蛋</h1>
              </div>
            ) : (
              <>
                <img src="/bomb-logo.png" alt="" style={styles.logo} />
                <h1 className="lobby-title" style={styles.title}>掼蛋</h1>
                <p style={styles.subtitle}>EggBomb · 多人在线</p>
              </>
            )}
          </div>

          {/* Player name input */}
          <div style={{ ...styles.formGroup, ...(compact ? { gap: '0.35rem' } : {}) }}>
            <label style={{ ...styles.label, ...(compact ? { fontSize: '0.78rem' } : {}) }}>你的名字</label>
            <input
              className="lobby-input"
              style={{ ...styles.input, ...(compact ? { padding: '0.5rem 0.75rem', fontSize: '0.9rem' } : {}) }}
              type="text"
              placeholder="输入昵称..."
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              maxLength={10}
              onKeyDown={(e) => e.key === 'Enter' && activeTab === 'create' && handleCreateRoom()}
            />
          </div>

          {/* Stats — show in left column in compact */}
          {compact && stats && (
            <div style={{ fontSize: '0.72rem', color: '#666' }}>
              {stats.roomCount}/{stats.maxRooms} 房间 · {stats.playerCount} 人在线
            </div>
          )}
        </div>

        {/* Right column in compact (or full width on desktop): tabs + actions */}
        <div style={compact ? { display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 } : { display: 'contents' }}>
          {/* Tabs */}
          <div style={{ ...styles.tabs, ...(compact ? { marginTop: 0 } : {}) }}>
            <button
              className={`lobby-tab ${activeTab === 'create' ? 'lobby-tab-active' : ''}`}
              style={{ ...styles.tab, ...(activeTab === 'create' ? styles.tabActive : {}), ...(compact ? { padding: '0.45rem', fontSize: '0.82rem' } : {}) }}
              onClick={() => setActiveTab('create')}
            >
              建房间
            </button>
            <button
              className={`lobby-tab ${activeTab === 'join' ? 'lobby-tab-active' : ''}`}
              style={{ ...styles.tab, ...(activeTab === 'join' ? styles.tabActive : {}), ...(compact ? { padding: '0.45rem', fontSize: '0.82rem' } : {}) }}
              onClick={() => setActiveTab('join')}
            >
              加入房间
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'create' ? (
            <div style={{ ...styles.tabContent, ...(compact ? { gap: '0.6rem' } : {}) }}>
              {!compact && <p style={styles.hint}>创建一个新房间，然后把房间号发给朋友</p>}
              <button
                className="lobby-primary-btn"
                style={{ ...styles.primaryBtn, ...(compact ? { padding: '0.6rem', fontSize: '0.9rem' } : {}) }}
                onClick={handleCreateRoom}
              >
                建房间
              </button>
            </div>
          ) : (
            <div style={{ ...styles.tabContent, ...(compact ? { gap: '0.6rem' } : {}) }}>
              <label style={{ ...styles.label, ...(compact ? { fontSize: '0.78rem' } : {}) }}>房间号</label>
              <input
                className="lobby-input"
                style={{ ...styles.input, ...(compact ? { padding: '0.5rem 0.75rem', fontSize: '0.9rem' } : {}) }}
                type="text"
                placeholder="输入6位房间号..."
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                maxLength={6}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
              />
              <button
                className="lobby-primary-btn"
                style={{ ...styles.primaryBtn, ...(compact ? { padding: '0.6rem', fontSize: '0.9rem' } : {}) }}
                onClick={handleJoinRoom}
              >
                加入房间
              </button>
            </div>
          )}

          {/* Stats — desktop only */}
          {!compact && stats && (
            <div className="lobby-fade-3" style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666' }}>
              当前 {stats.roomCount}/{stats.maxRooms} 个房间 · {stats.playerCount} 人在线
            </div>
          )}

          {/* Footer — desktop only */}
          {!compact && (
            <div className="lobby-fade-3" style={{ textAlign: 'center' }}>
              <p style={styles.footer}>掼蛋 · 4人扑克牌游戏 · 两队对战</p>
              <p style={{ ...styles.footer, marginTop: '0.25rem', fontSize: '0.68rem', color: '#555' }}>© 2026 Jia Guo · Apache 2.0</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    padding: '1rem',
    overflow: 'hidden',
    position: 'relative',
  },
  bgMesh: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,215,0,0.08), transparent 60%),' +
      'radial-gradient(ellipse 40% 40% at 15% 20%, rgba(79,195,247,0.06), transparent 60%),' +
      'radial-gradient(ellipse 40% 40% at 85% 80%, rgba(239,154,154,0.05), transparent 60%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(20px) saturate(140%)',
    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '18px',
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
  },
  titleSection: {
    textAlign: 'center',
  },
  logo: {
    width: '80px',
    height: '80px',
    display: 'block',
    margin: '0 auto 0.4rem',
    filter: 'drop-shadow(0 6px 18px rgba(255,215,0,0.25))',
  },
  logoCompact: {
    width: '38px',
    height: '38px',
    filter: 'drop-shadow(0 3px 8px rgba(255,215,0,0.25))',
  },
  title: {
    fontSize: '3rem',
    fontWeight: 800,
    letterSpacing: '0.12em',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: '#aaa',
    marginTop: '0.4rem',
    letterSpacing: '0.08em',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.85rem',
    color: '#bbb',
    fontWeight: 500,
  },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    color: '#fff',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    background: 'rgba(0,0,0,0.25)',
    borderRadius: '10px',
    padding: '0.25rem',
  },
  tab: {
    flex: 1,
    padding: '0.6rem',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  tabActive: {
    background: 'rgba(255,215,0,0.15)',
    color: '#ffd700',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  hint: {
    fontSize: '0.85rem',
    color: '#888',
    textAlign: 'center',
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #ffd700, #ffb300)',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: '8px',
    padding: '0.85rem',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.05em',
    boxShadow: '0 4px 14px rgba(255,179,0,0.2)',
  },
  footer: {
    textAlign: 'center',
    fontSize: '0.75rem',
    color: '#888',
    marginTop: '-0.5rem',
  },
};

export default LobbyPage;
