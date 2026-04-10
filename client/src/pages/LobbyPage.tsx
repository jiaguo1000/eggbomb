import React, { useState, useEffect } from 'react';
import { SOCKET_EVENTS } from '@eggbomb/shared';
import socket from '../socket';
import { useCompact } from '../hooks/useCompact';

interface LobbyPageProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
}

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

  return (
    <div style={{ ...styles.container, ...(compact ? { padding: '0.5rem', alignItems: 'center' } : {}) }}>
      <div style={{ ...styles.card, ...(compact ? { flexDirection: 'row', padding: '0.75rem 1rem', gap: '1rem', maxWidth: '560px' } : {}) }}>

        {/* Left column in compact: title + name input */}
        <div style={compact ? { display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, justifyContent: 'center' } : { display: 'contents' }}>
          {/* Title */}
          <div style={{ ...styles.titleSection, ...(compact ? { marginBottom: 0 } : {}) }}>
            <h1 style={{ ...styles.title, ...(compact ? { fontSize: '2rem' } : {}) }}>掼蛋</h1>
            {!compact && <p style={styles.subtitle}>Guan Dan · 多人联机</p>}
          </div>

          {/* Player name input */}
          <div style={{ ...styles.formGroup, ...(compact ? { gap: '0.35rem' } : {}) }}>
            <label style={{ ...styles.label, ...(compact ? { fontSize: '0.78rem' } : {}) }}>你的名字</label>
            <input
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
              style={{ ...styles.tab, ...(activeTab === 'create' ? styles.tabActive : {}), ...(compact ? { padding: '0.45rem', fontSize: '0.82rem' } : {}) }}
              onClick={() => setActiveTab('create')}
            >
              建房间
            </button>
            <button
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
              <button style={{ ...styles.primaryBtn, ...(compact ? { padding: '0.6rem', fontSize: '0.9rem' } : {}) }} onClick={handleCreateRoom}>
                建房间
              </button>
            </div>
          ) : (
            <div style={{ ...styles.tabContent, ...(compact ? { gap: '0.6rem' } : {}) }}>
              <label style={{ ...styles.label, ...(compact ? { fontSize: '0.78rem' } : {}) }}>房间号</label>
              <input
                style={{ ...styles.input, ...(compact ? { padding: '0.5rem 0.75rem', fontSize: '0.9rem' } : {}) }}
                type="text"
                placeholder="输入6位房间号..."
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                maxLength={6}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
              />
              <button style={{ ...styles.primaryBtn, ...(compact ? { padding: '0.6rem', fontSize: '0.9rem' } : {}) }} onClick={handleJoinRoom}>
                加入房间
              </button>
            </div>
          )}

          {/* Stats — desktop only */}
          {!compact && stats && (
            <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666' }}>
              当前 {stats.roomCount}/{stats.maxRooms} 个房间 · {stats.playerCount} 人在线
            </div>
          )}

          {/* Footer — desktop only */}
          {!compact && (
            <div style={{ textAlign: 'center' }}>
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
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '16px',
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  titleSection: {
    textAlign: 'center',
  },
  title: {
    fontSize: '3rem',
    fontWeight: 700,
    color: '#ffd700',
    letterSpacing: '0.1em',
    textShadow: '0 0 20px rgba(255,215,0,0.4)',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#aaa',
    marginTop: '0.25rem',
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
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    color: '#fff',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    background: 'rgba(0,0,0,0.2)',
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
    transition: 'all 0.2s',
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
    transition: 'transform 0.1s, opacity 0.2s',
    letterSpacing: '0.05em',
  },
  footer: {
    textAlign: 'center',
    fontSize: '0.75rem',
    color: '#888',
    marginTop: '-0.5rem',
  },
};

export default LobbyPage;
