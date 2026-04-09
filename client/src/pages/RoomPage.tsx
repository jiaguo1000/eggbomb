import React, { useState } from 'react';
import { Room, Player, PlayerSeat, SOCKET_EVENTS } from '@eggbomb/shared';
import socket from '../socket';
import SeatDisplay from '../components/SeatDisplay';
import { useCompact } from '../hooks/useCompact';

const LEVEL_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

interface RoomPageProps {
  room: Room;
  playerId: string;
  onLeave: () => void;
}

/**
 * Layout of seats around the table (CSS grid areas):
 *
 *        [North / Seat 2]
 *  [West]               [East]
 *  Seat 1               Seat 3
 *        [South / Seat 0]
 *
 * Team 0 (blue):  South (0) + North (2)
 * Team 1 (red):   West  (1) + East  (3)
 */

const RoomPage: React.FC<RoomPageProps> = ({ room, playerId, onLeave }) => {
  const compact = useCompact();
  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const me = room.players.find((p) => p.id === playerId);
  const hasSeat = me?.seat !== null && me?.seat !== undefined;
  const isReady = me?.isReady ?? false;
  const isHost = room.hostId === playerId;

  const getPlayerAtSeat = (seat: PlayerSeat): Player | undefined =>
    room.players.find((p) => p.seat === seat);

  const handleSitDown = (seat: PlayerSeat) => {
    socket.emit(SOCKET_EVENTS.CHOOSE_SEAT, { seat });
  };

  const handleAddBot = (seat: PlayerSeat, difficulty: 'easy' | 'medium') => {
    socket.emit(SOCKET_EVENTS.ADD_BOT, { seat, difficulty });
  };

  const handleRemoveBot = (seat: PlayerSeat) => {
    socket.emit(SOCKET_EVENTS.REMOVE_BOT, { seat });
  };

  const handleToggleReady = () => {
    socket.emit(SOCKET_EVENTS.PLAYER_READY);
  };

  const handleSetStartLevel = (level: number) => {
    socket.emit(SOCKET_EVENTS.SET_START_LEVEL, { level });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const allPlayersCount = room.players.length;
  const readyCount = room.players.filter((p) => p.isReady).length;
  const seatedCount = room.players.filter((p) => p.seat !== null).length;

  const phaseLabels: Record<string, string> = {
    WAITING: '等待玩家',
    DEALING: '发牌中...',
    PLAYING: '游戏进行中',
    ROUND_END: '本局结束',
    GAME_END: '游戏结束',
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={{ ...styles.header, ...(compact ? { padding: '0.2rem 0.75rem', gap: '0.3rem' } : {}) }}>
        <button style={{ ...styles.leaveBtn, ...(compact ? { fontSize: '0.75rem', padding: '0.3rem 0.7rem' } : {}) }} onClick={() => setShowLeaveConfirm(true)}>
          ← 离开
        </button>
        <div style={styles.headerCenter}>
          <span style={{ ...styles.phaseTag, ...(compact ? { fontSize: '0.68rem', padding: '0.15rem 0.5rem' } : {}) }}>{phaseLabels[room.phase] ?? room.phase}</span>
          {!compact && <span style={styles.playerCount}>{allPlayersCount}/4 人 · {readyCount} 准备</span>}
        </div>
        <div style={styles.roomCode}>
          {!compact && <span style={styles.roomCodeLabel}>房间号</span>}
          <button style={styles.roomCodeBtn} onClick={handleCopyCode} title="点击复制">
            <span style={{ ...styles.roomCodeText, ...(compact ? { fontSize: '0.85rem' } : {}) }}>{room.code}</span>
            <span style={{ ...styles.copyHint, ...(compact ? { fontSize: '0.62rem' } : {}) }}>{copied ? '已复制!' : '复制'}</span>
          </button>
        </div>
      </div>

      {/* Table layout */}
      <div style={{ ...styles.tableWrapper, ...(compact ? { padding: '0.2rem 0.5rem' } : {}) }}>
        <div style={{ ...styles.tableGrid, ...(compact ? { gap: '0.3rem', maxWidth: '560px' } : {}) }}>
          {/* North */}
          <div style={{ gridArea: 'north', display: 'flex', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: '4px' }}>
              <SeatDisplay seat={2} player={getPlayerAtSeat(2)} isCurrentPlayer={me?.seat === 2} onSitDown={handleSitDown} compact={compact} />
              {!getPlayerAtSeat(2) && isHost && (
                <div style={styles.botBtnGroup}>
                  <button style={styles.botBtn} onClick={() => handleAddBot(2 as PlayerSeat, 'easy')}>+简单</button>
                  <button style={styles.botBtnMedium} onClick={() => handleAddBot(2 as PlayerSeat, 'medium')}>+中等</button>
                </div>
              )}
              {getPlayerAtSeat(2)?.isBot && (
                <button style={isHost ? styles.kickBtn : styles.kickBtnDisabled} disabled={!isHost} title={isHost ? '' : '只有房主可以移除机器人'} onClick={() => handleRemoveBot(2 as PlayerSeat)}>踢出</button>
              )}
            </div>
          </div>

          {/* West */}
          <div style={{ gridArea: 'west', display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: '4px' }}>
              <SeatDisplay seat={1} player={getPlayerAtSeat(1)} isCurrentPlayer={me?.seat === 1} onSitDown={handleSitDown} compact={compact} />
              {!getPlayerAtSeat(1) && isHost && (
                <div style={styles.botBtnGroup}>
                  <button style={styles.botBtn} onClick={() => handleAddBot(1 as PlayerSeat, 'easy')}>+简单</button>
                  <button style={styles.botBtnMedium} onClick={() => handleAddBot(1 as PlayerSeat, 'medium')}>+中等</button>
                </div>
              )}
              {getPlayerAtSeat(1)?.isBot && (
                <button style={isHost ? styles.kickBtn : styles.kickBtnDisabled} disabled={!isHost} title={isHost ? '' : '只有房主可以移除机器人'} onClick={() => handleRemoveBot(1 as PlayerSeat)}>踢出</button>
              )}
            </div>
          </div>

          {/* Center table */}
          <div style={styles.tableCenter}>
            <div style={{ ...styles.tableInner, ...(compact ? { width: '160px', padding: '0.4rem 0.6rem', gap: '0.3rem' } : {}) }}>
              {!compact && <span style={styles.tableTitle}>掼蛋</span>}
              <div style={styles.teamInfo}>
                <div style={styles.teamRow}>
                  <span style={{ ...styles.teamDot, background: '#4fc3f7' }} />
                  <span style={styles.teamText}>
                    南北
                    <span style={styles.levelBadge}>Lv.{LEVEL_LABELS[room.currentLevel[0]] ?? room.currentLevel[0]}</span>
                  </span>
                </div>
                <div style={styles.teamRow}>
                  <span style={{ ...styles.teamDot, background: '#ef9a9a' }} />
                  <span style={styles.teamText}>
                    东西
                    <span style={styles.levelBadge}>Lv.{LEVEL_LABELS[room.currentLevel[1]] ?? room.currentLevel[1]}</span>
                  </span>
                </div>
              </div>
              <div style={styles.startLevelSection}>
                <span style={styles.startLevelLabel}>起始</span>
                <div style={styles.startLevelPicker}>
                  {(compact ? [[2,3,4,5,6],[7,8,9,10],[11,12,13,14]] : [[2,3,4,5,6,7,8,9,10],[11,12,13,14]]).map((row, ri) => (
                    <div key={ri} style={styles.startLevelRow}>
                      {row.map((lv) => (
                        <button
                          key={lv}
                          style={{
                            ...styles.levelBtn,
                            ...((room.startLevel ?? 2) === lv ? styles.levelBtnActive : {}),
                            cursor: isHost ? 'pointer' : 'default',
                            opacity: isHost ? 1 : 0.6,
                          }}
                          onClick={() => isHost && handleSetStartLevel(lv)}
                          title={isHost ? '' : '只有房主可以设置起始级数'}
                        >
                          {LEVEL_LABELS[lv]}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              {allPlayersCount < 4 && (
                <p style={styles.waitingText}>
                  等待 {4 - allPlayersCount} 人加入...
                </p>
              )}
            </div>
          </div>

          {/* East */}
          <div style={{ gridArea: 'east', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: '4px' }}>
              <SeatDisplay seat={3} player={getPlayerAtSeat(3)} isCurrentPlayer={me?.seat === 3} onSitDown={handleSitDown} compact={compact} />
              {!getPlayerAtSeat(3) && isHost && (
                <div style={styles.botBtnGroup}>
                  <button style={styles.botBtn} onClick={() => handleAddBot(3 as PlayerSeat, 'easy')}>+简单</button>
                  <button style={styles.botBtnMedium} onClick={() => handleAddBot(3 as PlayerSeat, 'medium')}>+中等</button>
                </div>
              )}
              {getPlayerAtSeat(3)?.isBot && (
                <button style={isHost ? styles.kickBtn : styles.kickBtnDisabled} disabled={!isHost} title={isHost ? '' : '只有房主可以移除机器人'} onClick={() => handleRemoveBot(3 as PlayerSeat)}>踢出</button>
              )}
            </div>
          </div>

          {/* South */}
          <div style={{ gridArea: 'south', display: 'flex', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: '4px' }}>
              <SeatDisplay seat={0} player={getPlayerAtSeat(0)} isCurrentPlayer={me?.seat === 0} onSitDown={handleSitDown} compact={compact} />
              {!getPlayerAtSeat(0) && isHost && (
                <div style={styles.botBtnGroup}>
                  <button style={styles.botBtn} onClick={() => handleAddBot(0 as PlayerSeat, 'easy')}>+简单</button>
                  <button style={styles.botBtnMedium} onClick={() => handleAddBot(0 as PlayerSeat, 'medium')}>+中等</button>
                </div>
              )}
              {getPlayerAtSeat(0)?.isBot && (
                <button style={isHost ? styles.kickBtn : styles.kickBtnDisabled} disabled={!isHost} title={isHost ? '' : '只有房主可以移除机器人'} onClick={() => handleRemoveBot(0 as PlayerSeat)}>踢出</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Leave confirmation modal */}
      {showLeaveConfirm && (() => {
        const otherHumans = room.players.filter((p) => !p.isBot && p.id !== playerId);
        const msg = otherHumans.length > 0
          ? '确认离开房间？'
          : '你是最后一位玩家，离开后房间将关闭。';
        return (
          <div style={confirmStyles.overlay}>
            <div style={confirmStyles.box}>
              <p style={confirmStyles.text}>{msg}</p>
              <div style={confirmStyles.btns}>
                <button style={confirmStyles.cancelBtn} onClick={() => setShowLeaveConfirm(false)}>取消</button>
                <button style={confirmStyles.confirmBtn} onClick={onLeave}>确认离开</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Action bar */}
      <div style={{ ...styles.actionBar, ...(compact ? { padding: '0.2rem 1rem' } : {}) }}>
        {!hasSeat ? (
          <p style={{ ...styles.actionHint, ...(compact ? { fontSize: '0.75rem' } : {}) }}>点击空座位入座</p>
        ) : (
          <button
            style={{
              ...styles.readyBtn,
              background: isReady
                ? 'linear-gradient(135deg, #388e3c, #2e7d32)'
                : 'linear-gradient(135deg, #ffd700, #ffb300)',
              color: isReady ? '#e8f5e9' : '#1a1a1a',
              ...(compact ? { padding: '0.5rem 1.5rem', fontSize: '0.9rem' } : {}),
            }}
            onClick={handleToggleReady}
          >
            {isReady ? '✓ 已准备 (取消)' : '准备'}
          </button>
        )}
        {!compact && <p style={styles.seatedStatus}>{seatedCount}/4 人已入座</p>}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'linear-gradient(160deg, #0d1b2a 0%, #1b2838 50%, #162032 100%)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  leaveBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#ccc',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  headerCenter: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.2rem',
  },
  botBtnGroup: {
    display: 'flex',
    gap: '4px',
  },
  botBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#aaa',
    borderRadius: '6px',
    padding: '3px 8px',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  botBtnMedium: {
    background: 'rgba(79,195,247,0.12)',
    border: '1px solid rgba(79,195,247,0.3)',
    color: '#4fc3f7',
    borderRadius: '6px',
    padding: '3px 8px',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  botBtnDisabled: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#444',
    borderRadius: '6px',
    padding: '3px 8px',
    fontSize: '0.75rem',
    cursor: 'not-allowed',
  },
  kickBtn: {
    background: 'rgba(220,50,50,0.15)',
    border: '1px solid rgba(220,50,50,0.3)',
    color: '#ef9a9a',
    borderRadius: '6px',
    padding: '3px 10px',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  kickBtnDisabled: {
    background: 'rgba(220,50,50,0.04)',
    border: '1px solid rgba(220,50,50,0.1)',
    color: '#555',
    borderRadius: '6px',
    padding: '3px 10px',
    fontSize: '0.75rem',
    cursor: 'not-allowed',
  },
  phaseTag: {
    background: 'rgba(255,215,0,0.15)',
    color: '#ffd700',
    padding: '0.25rem 0.75rem',
    borderRadius: '20px',
    fontSize: '0.8rem',
    fontWeight: 600,
    border: '1px solid rgba(255,215,0,0.3)',
  },
  playerCount: {
    fontSize: '0.75rem',
    color: '#666',
  },
  roomCode: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.2rem',
  },
  roomCodeLabel: {
    fontSize: '0.7rem',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  roomCodeBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    padding: '0.4rem 0.8rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  roomCodeText: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#ffd700',
    letterSpacing: '0.1em',
    fontFamily: 'monospace',
  },
  copyHint: {
    fontSize: '0.7rem',
    color: '#888',
  },
  tableWrapper: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.75rem 1.5rem',
    overflow: 'hidden',
  },
  tableGrid: {
    display: 'grid',
    gridTemplateAreas: `
      ". north ."
      "west center east"
      ". south ."
    `,
    gridTemplateColumns: 'auto 1fr auto',
    gridTemplateRows: 'auto 1fr auto',
    gap: '0.75rem',
    width: '100%',
    maxWidth: '700px',
  },
  tableCenter: {
    gridArea: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableInner: {
    background: 'rgba(10,60,30,0.4)',
    border: '2px solid rgba(255,255,255,0.08)',
    borderRadius: '24px',
    width: '220px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
  },
  tableTitle: {
    fontSize: '1.8rem',
    fontWeight: 700,
    color: '#ffd700',
    letterSpacing: '0.1em',
  },
  teamInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    width: '100%',
    paddingInline: '0.5rem',
  },
  teamRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  teamDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  teamText: {
    fontSize: '0.72rem',
    color: '#aaa',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  levelBadge: {
    background: 'rgba(255,215,0,0.1)',
    color: '#ffd700',
    border: '1px solid rgba(255,215,0,0.2)',
    borderRadius: '4px',
    padding: '0 0.3rem',
    fontSize: '0.65rem',
    fontWeight: 600,
  },
  waitingText: {
    fontSize: '0.72rem',
    color: '#555',
    textAlign: 'center',
  },
  startLevelBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '6px 1.5rem',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
  },
  startLevelLabel: {
    fontSize: '0.75rem',
    color: '#666',
    flexShrink: 0,
  },
  startLevelPicker: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    alignItems: 'center',
  },
  startLevelRow: {
    display: 'flex',
    gap: '3px',
  },
  levelBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#888',
    borderRadius: '4px',
    padding: '1px 4px',
    fontSize: '0.65rem',
    fontWeight: 600,
    minWidth: '20px',
    textAlign: 'center',
  },
  levelBtnActive: {
    background: 'rgba(255,215,0,0.2)',
    border: '1px solid rgba(255,215,0,0.5)',
    color: '#ffd700',
  },
  actionBar: {
    padding: '1rem 1.5rem',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5rem',
    flexWrap: 'wrap',
  },
  actionHint: {
    color: '#666',
    fontSize: '0.9rem',
  },
  readyBtn: {
    border: 'none',
    borderRadius: '10px',
    padding: '0.85rem 2.5rem',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'transform 0.1s, opacity 0.2s',
    letterSpacing: '0.05em',
  },
  seatedStatus: {
    fontSize: '0.8rem',
    color: '#555',
  },
};

const confirmStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box: { background: '#1a2a35', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px', padding: '1.5rem 1.75rem', maxWidth: '360px', width: '90%', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  text: { color: '#ddd', fontSize: '0.95rem', lineHeight: 1.5, textAlign: 'center' },
  btns: { display: 'flex', gap: '0.75rem' },
  cancelBtn: { flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)', color: '#ccc', cursor: 'pointer', fontSize: '0.9rem' },
  confirmBtn: { flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #e53935, #c62828)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700 },
};

export default RoomPage;
