import React, { useState, useEffect } from 'react';
import { SOCKET_EVENTS } from '@eggbomb/shared';
import socket from '../socket';

interface LobbyPageProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
}

const LobbyPage: React.FC<LobbyPageProps> = ({ playerName, onPlayerNameChange }) => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [stats, setStats] = useState<{ roomCount: number; playerCount: number; maxRooms: number } | null>(null);

  useEffect(() => {
    fetch('/stats')
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
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Title */}
        <div style={styles.titleSection}>
          <h1 style={styles.title}>掼蛋</h1>
          <p style={styles.subtitle}>Guan Dan · 多人联机</p>
        </div>

        {/* Player name input */}
        <div style={styles.formGroup}>
          <label style={styles.label}>你的名字</label>
          <input
            style={styles.input}
            type="text"
            placeholder="输入昵称..."
            value={playerName}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            maxLength={16}
            onKeyDown={(e) => e.key === 'Enter' && activeTab === 'create' && handleCreateRoom()}
          />
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(activeTab === 'create' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('create')}
          >
            建房间
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === 'join' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('join')}
          >
            加入房间
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'create' ? (
          <div style={styles.tabContent}>
            <p style={styles.hint}>创建一个新房间，然后把房间号发给朋友</p>
            <button style={styles.primaryBtn} onClick={handleCreateRoom}>
              建房间
            </button>
          </div>
        ) : (
          <div style={styles.tabContent}>
            <label style={styles.label}>房间号</label>
            <input
              style={styles.input}
              type="text"
              placeholder="输入6位房间号..."
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
            />
            <button style={styles.primaryBtn} onClick={handleJoinRoom}>
              加入房间
            </button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666' }}>
            当前 {stats.roomCount}/{stats.maxRooms} 个房间 · {stats.playerCount} 人在线
          </div>
        )}

        {/* Footer */}
        <p style={styles.footer}>掼蛋 · 4人扑克牌游戏 · 两队对战</p>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    padding: '1rem',
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
