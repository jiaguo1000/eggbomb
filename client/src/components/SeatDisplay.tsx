import React from 'react';
import { Player, PlayerSeat } from '@eggbomb/shared';

interface SeatDisplayProps {
  seat: PlayerSeat;
  player?: Player;
  isCurrentPlayer: boolean;
  onSitDown: (seat: PlayerSeat) => void;
}

const SEAT_LABELS: Record<PlayerSeat, string> = {
  0: '南 (South)',
  1: '西 (West)',
  2: '北 (North)',
  3: '东 (East)',
};

const TEAM_COLORS: Record<number, string> = {
  0: '#4fc3f7', // Team 0 (seats 0 & 2) — blue
  1: '#ef9a9a', // Team 1 (seats 1 & 3) — red
};

const SeatDisplay: React.FC<SeatDisplayProps> = ({ seat, player, isCurrentPlayer, onSitDown }) => {
  const isEmpty = !player;
  const teamColor = player?.teamId !== null && player?.teamId !== undefined
    ? TEAM_COLORS[player.teamId]
    : 'transparent';

  const handleClick = () => {
    if (isEmpty) {
      onSitDown(seat);
    }
  };

  return (
    <div
      style={{
        ...styles.seat,
        ...(isEmpty ? styles.emptySeat : styles.occupiedSeat),
        ...(isCurrentPlayer ? styles.currentPlayerSeat : {}),
        cursor: isEmpty ? 'pointer' : 'default',
        borderColor: isCurrentPlayer ? '#ffd700' : isEmpty ? 'rgba(255,255,255,0.15)' : teamColor,
      }}
      onClick={handleClick}
      title={isEmpty ? `点击坐下 — ${SEAT_LABELS[seat]}` : player?.name}
    >
      {/* Seat label */}
      <span style={styles.seatLabel}>{SEAT_LABELS[seat]}</span>

      {/* Avatar / icon */}
      <div
        style={{
          ...styles.avatar,
          background: isEmpty
            ? 'rgba(255,255,255,0.05)'
            : `radial-gradient(circle, ${teamColor}33, ${teamColor}11)`,
          borderColor: isEmpty ? 'rgba(255,255,255,0.1)' : teamColor,
        }}
      >
        {isEmpty ? (
          <span style={styles.plusIcon}>+</span>
        ) : (
          <span style={styles.playerInitial}>
            {player!.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Player info or empty state */}
      {isEmpty ? (
        <span style={styles.emptyText}>空座位</span>
      ) : (
        <>
          <span style={{ ...styles.playerName, color: isCurrentPlayer ? '#ffd700' : '#e0e0e0' }}>
            {player!.name}
            {isCurrentPlayer && ' (你)'}
          </span>
          <div style={styles.statusRow}>
            {player!.isBot && <span style={styles.botBadge}>机器人</span>}
            <span
              style={{
                ...styles.readyBadge,
                background: player!.isReady ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.05)',
                color: player!.isReady ? '#81c784' : '#888',
                borderColor: player!.isReady ? '#81c784' : 'rgba(255,255,255,0.1)',
              }}
            >
              {player!.isReady ? '已准备' : '未准备'}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  seat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '1rem 0.75rem',
    borderRadius: '12px',
    border: '2px solid',
    minWidth: '120px',
    minHeight: '160px',
    justifyContent: 'center',
    transition: 'all 0.2s',
    userSelect: 'none',
  },
  emptySeat: {
    background: 'rgba(255,255,255,0.03)',
  },
  occupiedSeat: {
    background: 'rgba(255,255,255,0.06)',
  },
  currentPlayerSeat: {
    background: 'rgba(255,215,0,0.05)',
    boxShadow: '0 0 16px rgba(255,215,0,0.15)',
  },
  seatLabel: {
    fontSize: '0.7rem',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  avatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '0.25rem',
  },
  plusIcon: {
    fontSize: '1.5rem',
    color: '#555',
    lineHeight: 1,
  },
  playerInitial: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#e0e0e0',
  },
  emptyText: {
    fontSize: '0.8rem',
    color: '#555',
    marginTop: '0.25rem',
  },
  playerName: {
    fontSize: '0.9rem',
    fontWeight: 600,
    textAlign: 'center',
    maxWidth: '110px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusRow: {
    display: 'flex',
    gap: '0.35rem',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  readyBadge: {
    fontSize: '0.7rem',
    padding: '0.2rem 0.5rem',
    borderRadius: '20px',
    border: '1px solid',
  },
  botBadge: {
    fontSize: '0.7rem',
    padding: '0.2rem 0.5rem',
    borderRadius: '20px',
    background: 'rgba(156,39,176,0.2)',
    color: '#ce93d8',
    border: '1px solid #ce93d8',
  },
};

export default SeatDisplay;
