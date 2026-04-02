import React, { useState, useEffect, useRef } from 'react';
import { Room, Card, Suit, PlayerSeat, HandType, HandResult, SOCKET_EVENTS, CardsPlayedPayload, classifyAllPossible, isBomb, GameResult, TributeState, getGameValue, DiceRollPayload } from '@eggbomb/shared';
import socket from '../socket';
import CardComponent from '../components/CardComponent';
import { useCompact } from '../hooks/useCompact';

interface GamePageProps {
  room: Room;
  playerId: string;
  hand: Card[];
  currentLevel: number;
  onLeave: () => void;
}

function isWildcard(card: Card, currentLevel: number): boolean {
  const levelRank = currentLevel === 14 ? 1 : currentLevel;
  return card.suit === Suit.HEART && card.rank === levelRank;
}

function sortHand(hand: Card[], currentLevel: number): Card[] {
  return [...hand].sort((a, b) => {
    const valA = getDisplayValue(a, currentLevel);
    const valB = getDisplayValue(b, currentLevel);
    if (valA !== valB) return valA - valB;
    // Same rank: sort by suit SPADE < CLUB < DIAMOND < HEART
    const suitOrder = { [Suit.SPADE]: 0, [Suit.CLUB]: 1, [Suit.DIAMOND]: 2, [Suit.HEART]: 3, [Suit.JOKER]: 4 };
    return suitOrder[a.suit] - suitOrder[b.suit];
  });
}

function getDisplayValue(card: Card, currentLevel: number): number {
  if (card.suit === Suit.JOKER) return card.rank === 14 ? 17 : 18;
  if (isWildcard(card, currentLevel)) return 16;
  if (card.rank === currentLevel) return 15.5; // non-wildcard level card
  if (card.rank === 1) return 14;
  return card.rank;
}

const SEAT_LABELS = ['南', '西', '北', '东'];

const GamePage: React.FC<GamePageProps> = ({ room, playerId, hand, currentLevel, onLeave }) => {
  const compact = useCompact();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [myHand, setMyHand] = useState<Card[]>(hand);
  const [currentRoom, setCurrentRoom] = useState<Room>(room);
  const [message, setMessage] = useState<string>('');
  const [finishedPlayers, setFinishedPlayers] = useState<Set<string>>(new Set());
  const [handTypeChoices, setHandTypeChoices] = useState<HandResult[] | null>(null);
  const [pendingCardIds, setPendingCardIds] = useState<string[] | null>(null);
  const [chosenType, setChosenType] = useState<HandType | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [tributeState, setTributeState] = useState<TributeState | null>(null);
  const [passedSeats, setPassedSeats] = useState<Set<PlayerSeat>>(new Set());
  const [diceResult, setDiceResult] = useState<DiceRollPayload | null>(null);
  const [diceOverlayDone, setDiceOverlayDone] = useState(false);
  const [turnCountdown, setTurnCountdown] = useState<number | null>(null);
  const [tributeReveal, setTributeReveal] = useState<{ fromName: string; toName: string; tributeCard: Card | null; returnCard: Card | null }[] | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPlayedFirstCardRef = useRef(false);

  const me = currentRoom.players.find((p) => p.id === playerId);
  const mySeat = me?.seat ?? 0;
  const isMyTurn = currentRoom.currentTurn === mySeat;
  const canPass = isMyTurn && currentRoom.lastPlay !== null && currentRoom.lastPlay.playerId !== playerId;

  useEffect(() => {
    setMyHand(sortHand(hand, currentLevel));
  }, [hand, currentLevel]);

  // Countdown timer when it's my turn
  useEffect(() => {
    const isManaged = (currentRoom.managedPlayerIds ?? []).includes(playerId);
    if (isMyTurn && !isManaged && currentRoom.phase === 'PLAYING') {
      const turnLimit = hasPlayedFirstCardRef.current ? 30 : 60;
      setTurnCountdown(turnLimit);
      countdownRef.current = setInterval(() => {
        setTurnCountdown((prev) => {
          if (prev === null || prev <= 1) return null;
          return prev - 1;
        });
      }, 1000);
      autoPlayRef.current = setTimeout(() => {
        socket.emit(SOCKET_EVENTS.AUTO_PLAY);
      }, turnLimit * 1000);
    } else {
      setTurnCountdown(null);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (autoPlayRef.current) { clearTimeout(autoPlayRef.current); autoPlayRef.current = null; }
    }
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (autoPlayRef.current) { clearTimeout(autoPlayRef.current); autoPlayRef.current = null; }
    };
  }, [isMyTurn, currentRoom.phase, currentRoom.managedPlayerIds, playerId]);

  useEffect(() => {
    const handleRoomUpdate = ({ room: updatedRoom }: { room: Room }) => {
      setCurrentRoom(updatedRoom);
      // Clear passed indicators when a new round starts
      if (!updatedRoom.lastPlay && updatedRoom.consecutivePasses === 0 && Object.keys(updatedRoom.currentRoundPlays).length === 0) {
        setPassedSeats(new Set());
      }
    };

    const handleCardsPlayed = (payload: CardsPlayedPayload) => {
      if (payload.playerId === playerId) {
        setMyHand((prev) => sortHand(prev.filter((c) => !payload.cards.find((pc) => pc.id === c.id)), currentLevel));
        setSelectedIds(new Set());
        hasPlayedFirstCardRef.current = true;
      }
    };

    const handlePassTurn = (payload: { playerId: string; seat: PlayerSeat }) => {
      if (payload.playerId === playerId) setSelectedIds(new Set());
      setPassedSeats(prev => { const n = new Set(prev); n.add(payload.seat as PlayerSeat); return n; });
    };

    const handlePlayerFinished = (payload: { playerId: string; finishPosition: number }) => {
      setFinishedPlayers((prev) => new Set([...prev, payload.playerId]));
    };

    const handleGameEnded = (payload: { gameResult: GameResult }) => {
      setGameResult(payload.gameResult);
    };

    const handleTributeState = (payload: { tributeState: TributeState }) => {
      setTributeState(payload.tributeState);
      setGameResult(null); // tribute started, hide game result overlay
    };

    const handleDiceRoll = (payload: DiceRollPayload) => {
      setDiceOverlayDone(false);
      setDiceResult(payload);
    };

    const handleHint = ({ cardIds }: { cardIds: string[] }) => {
      if (cardIds.length === 0) {
        showMessage('没有可以出的牌，只能过');
      } else {
        setSelectedIds(new Set(cardIds));
      }
    };

    const handleTributeReveal = ({ entries }: { entries: { fromName: string; toName: string; tributeCard: Card | null; returnCard: Card | null }[] }) => {
      setTributeReveal(entries);
      setTimeout(() => setTributeReveal(null), 5000);
    };

    const handleNewGameStarting = () => {
      setGameResult(null);
      setTributeState(null);
      // Do NOT clear myHand — it was already updated via DEAL_CARDS during tribute
      setSelectedIds(new Set());
      setFinishedPlayers(new Set());
      setPassedSeats(new Set());
      hasPlayedFirstCardRef.current = false;
    };

    socket.on(SOCKET_EVENTS.ROOM_UPDATE, handleRoomUpdate);
    socket.on(SOCKET_EVENTS.CARDS_PLAYED, handleCardsPlayed);
    socket.on(SOCKET_EVENTS.PASS_TURN, handlePassTurn);
    socket.on(SOCKET_EVENTS.PLAYER_FINISHED, handlePlayerFinished);
    socket.on(SOCKET_EVENTS.GAME_ENDED, handleGameEnded);
    socket.on(SOCKET_EVENTS.TRIBUTE_STATE, handleTributeState);
    socket.on(SOCKET_EVENTS.NEW_GAME_STARTING, handleNewGameStarting);
    socket.on(SOCKET_EVENTS.DICE_ROLL, handleDiceRoll);
    socket.on(SOCKET_EVENTS.HINT, handleHint);
    socket.on(SOCKET_EVENTS.TRIBUTE_REVEAL, handleTributeReveal);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_UPDATE, handleRoomUpdate);
      socket.off(SOCKET_EVENTS.CARDS_PLAYED, handleCardsPlayed);
      socket.off(SOCKET_EVENTS.PASS_TURN, handlePassTurn);
      socket.off(SOCKET_EVENTS.PLAYER_FINISHED, handlePlayerFinished);
      socket.off(SOCKET_EVENTS.GAME_ENDED, handleGameEnded);
      socket.off(SOCKET_EVENTS.TRIBUTE_STATE, handleTributeState);
      socket.off(SOCKET_EVENTS.NEW_GAME_STARTING, handleNewGameStarting);
      socket.off(SOCKET_EVENTS.DICE_ROLL, handleDiceRoll);
      socket.off(SOCKET_EVENTS.HINT, handleHint);
      socket.off(SOCKET_EVENTS.TRIBUTE_REVEAL, handleTributeReveal);
    };
  }, [currentRoom, playerId, currentLevel]);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }

  function toggleCard(cardId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function handlePlay() {
    if (selectedIds.size === 0) return;
    const cardIds = Array.from(selectedIds);

    // Get selected card objects
    const selectedCards = myHand.filter((c) => selectedIds.has(c.id));

    // Check for ambiguous hand types
    const possible = classifyAllPossible(selectedCards, currentLevel);

    if (possible.length === 0) {
      // Will let server reject it with proper error
      socket.emit(SOCKET_EVENTS.PLAY_CARDS, { cardIds });
      return;
    }

    if (possible.length > 1) {
      // Show type selection modal
      setPendingCardIds(cardIds);
      setHandTypeChoices(possible);
      return;
    }

    // Only one possible type, play directly
    socket.emit(SOCKET_EVENTS.PLAY_CARDS, { cardIds, intendedType: possible[0].type });
  }

  function handleChooseType(type: HandType) {
    if (!pendingCardIds) return;
    socket.emit(SOCKET_EVENTS.PLAY_CARDS, { cardIds: pendingCardIds, intendedType: type });
    setHandTypeChoices(null);
    setPendingCardIds(null);
    setChosenType(null);
    setSelectedIds(new Set());
  }

  function cancelChooseType() {
    setHandTypeChoices(null);
    setPendingCardIds(null);
    setChosenType(null);
  }

  function handlePass() {
    socket.emit(SOCKET_EVENTS.PASS_TURN);
  }

  // Layout: my seat at bottom, opponents relative to me
  // Seat arrangement: 0=South(bottom), 1=West(left), 2=North(top), 3=East(right)
  // Relative to mySeat: opposite=(mySeat+2)%4, left=(mySeat+1)%4, right=(mySeat+3)%4
  const oppositeSeat = ((mySeat + 2) % 4) as PlayerSeat;
  const leftSeat = ((mySeat + 1) % 4) as PlayerSeat;
  const rightSeat = ((mySeat + 3) % 4) as PlayerSeat;

  const getPlayerBySeat = (seat: PlayerSeat) => currentRoom.players.find((p) => p.seat === seat);
  const getHandCount = (pid?: string) => pid ? (currentRoom.handCount?.[pid] ?? 27) : 27;

  const opponentTop = getPlayerBySeat(oppositeSeat);
  const opponentLeft = getPlayerBySeat(leftSeat);
  const opponentRight = getPlayerBySeat(rightSeat);

  const levelLabels = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

  // Which team's level is being played this round
  const playingTeam: 0 | 1 | null = currentRoom.playingAceTeam !== null
    ? currentRoom.playingAceTeam
    : currentRoom.currentLevel[0] !== currentRoom.currentLevel[1]
      ? (currentRoom.currentLevel[0] === currentLevel ? 0 : 1)
      : null;

  return (
    <div style={styles.container}>
      <style>{`@keyframes pulse { from { opacity: 1; transform: scale(1); } to { opacity: 0.7; transform: scale(1.06); } }`}</style>
      {/* Header bar */}
      <div style={{ ...styles.header, ...(compact ? { padding: '4px 10px' } : {}) }}>
        <span style={styles.headerInfo}>房间：{currentRoom.code}</span>
        <div style={styles.headerLevels}>
          {[0, 1].map((team) => {
            const lvl = currentRoom.currentLevel[team as 0 | 1];
            const lvlLabel = levelLabels[lvl - 2] ?? 'A';
            const isMine = me?.teamId === team;
            const teamName = team === 0 ? 'A队(南北)' : 'B队(东西)';
            const failures = currentRoom.aceFailures?.[team as 0 | 1] ?? 0;
            const isPlayingAce = lvl === 14 && failures > 0;
            const isPlaying = playingTeam === team;
            return (
              <span key={team} style={{ ...styles.teamLevel, ...(isMine ? styles.teamLevelMine : {}), ...(isPlaying && !isMine ? styles.teamLevelPlaying : {}) }}>
                {teamName}: {lvlLabel}
                {isPlaying && <span style={{ color: '#ffd700', marginLeft: '5px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(255,215,0,0.15)', borderRadius: '3px', padding: '0 4px' }}>本盘</span>}
                {isPlayingAce && (
                  <span style={{ color: '#ff6b6b', marginLeft: '4px', fontSize: '0.75rem' }}>
                    {'❌'.repeat(failures)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <button style={styles.leaveBtn} onClick={onLeave}>离开</button>
      </div>

      {/* Game table */}
      <div style={{ ...styles.table, ...(compact ? { padding: '4px 8px', gap: '4px' } : {}) }}>

        {/* Top opponent + their play */}
        <div style={{ ...styles.topArea, ...(compact ? { height: 'auto' } : {}) }}>
          {opponentTop ? (
            <div style={{ ...styles.opponentWithPlay, ...(compact ? { height: 'auto', gap: '0' } : {}) }}>
              <OpponentDisplay compact={compact} player={opponentTop} handCount={getHandCount(opponentTop.id)} isCurrentTurn={currentRoom.currentTurn === opponentTop.seat} isFinished={finishedPlayers.has(opponentTop.id)} isManaged={(currentRoom.managedPlayerIds ?? []).includes(opponentTop.id)} isDisconnected={(currentRoom.disconnectedPlayerIds ?? []).includes(opponentTop.id)} />
              {compact ? (
                <div style={styles.compactPlayRow}>
                  <CompactPlay cards={currentRoom.currentRoundPlays?.[oppositeSeat]?.cards} passed={passedSeats.has(oppositeSeat) && !currentRoom.currentRoundPlays?.[oppositeSeat]} />
                </div>
              ) : (
                <div style={styles.oppPlayRow}>
                  {passedSeats.has(oppositeSeat) && !currentRoom.currentRoundPlays?.[oppositeSeat] ? (
                    <div style={{ color: '#aaa', fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>过</div>
                  ) : (
                    <RoundPlayInline play={currentRoom.currentRoundPlays?.[oppositeSeat]} currentLevel={currentLevel} small />
                  )}
                </div>
              )}
            </div>
          ) : <EmptySeat seat={oppositeSeat} />}
        </div>

        {/* Middle row: left, center, right */}
        <div style={{ ...styles.middleRow, ...(compact ? { gap: '6px' } : {}) }}>
          {/* Left opponent */}
          <div style={{ ...styles.sideArea, ...(compact ? { minWidth: '80px', alignItems: 'flex-start' } : {}) }}>
            {opponentLeft ? (
              <div style={{ ...styles.opponentWithPlay, ...(compact ? { height: 'auto', gap: '0' } : {}) }}>
                <OpponentDisplay compact={compact} player={opponentLeft} handCount={getHandCount(opponentLeft.id)} isCurrentTurn={currentRoom.currentTurn === opponentLeft.seat} isFinished={finishedPlayers.has(opponentLeft.id)} isManaged={(currentRoom.managedPlayerIds ?? []).includes(opponentLeft.id)} isDisconnected={(currentRoom.disconnectedPlayerIds ?? []).includes(opponentLeft.id)} />
                {compact ? (
                  <div style={styles.compactPlayRow}>
                    <CompactPlay cards={currentRoom.currentRoundPlays?.[leftSeat]?.cards} passed={passedSeats.has(leftSeat) && !currentRoom.currentRoundPlays?.[leftSeat]} />
                  </div>
                ) : (
                  <div style={styles.oppPlayRow}>
                    {passedSeats.has(leftSeat) && !currentRoom.currentRoundPlays?.[leftSeat] ? (
                      <div style={{ color: '#aaa', fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>过</div>
                    ) : (
                      <RoundPlayInline play={currentRoom.currentRoundPlays?.[leftSeat]} currentLevel={currentLevel} small />
                    )}
                  </div>
                )}
              </div>
            ) : <EmptySeat seat={leftSeat} />}
          </div>

          {/* Center: turn indicator + last play (compact: text summary) */}
          <div style={{ ...styles.centerArea, ...(compact ? { height: 'auto', minHeight: '60px' } : {}) }}>
            {message && (
              <span style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '5px 16px', borderRadius: '16px', fontSize: '0.88rem', border: '1px solid rgba(255,255,255,0.15)', marginBottom: '8px' }}>
                {message}
              </span>
            )}
            {isMyTurn ? (
              <div style={{ ...styles.turnIndicator, ...(compact ? { fontSize: '1.1rem', marginTop: '0' } : {}), animation: 'pulse 0.8s ease-in-out infinite alternate', ...(turnCountdown !== null && turnCountdown <= 10 ? { color: '#ff6b6b', textShadow: '0 0 16px rgba(255,80,80,0.9)' } : {}) }}>
                ⚡ 轮到你了！{turnCountdown !== null && <span style={{ marginLeft: '8px' }}>({turnCountdown}s)</span>}
              </div>
            ) : (
              <div style={styles.noLastPlay}>
                {currentRoom.lastPlay ? '等待出牌...' : '新一轮'}
              </div>
            )}
            {currentRoom.lastPlay && (
              <div style={{ color: '#ffd700', fontSize: '0.72rem', marginTop: '4px', textAlign: 'center' }}>
                {currentRoom.players.find(p => p.id === currentRoom.lastPlay!.playerId)?.name}：{handTypeLabel(currentRoom.lastPlay.hand.type)} ({currentRoom.lastPlay.cards.length}张)
              </div>
            )}
          </div>

          {/* Right opponent */}
          <div style={{ ...styles.sideArea, ...(compact ? { minWidth: '80px', alignItems: 'flex-start', justifyContent: 'flex-end' } : {}) }}>
            {opponentRight ? (
              <div style={{ ...styles.opponentWithPlay, ...(compact ? { height: 'auto', gap: '0' } : {}) }}>
                <OpponentDisplay compact={compact} player={opponentRight} handCount={getHandCount(opponentRight.id)} isCurrentTurn={currentRoom.currentTurn === opponentRight.seat} isFinished={finishedPlayers.has(opponentRight.id)} isManaged={(currentRoom.managedPlayerIds ?? []).includes(opponentRight.id)} isDisconnected={(currentRoom.disconnectedPlayerIds ?? []).includes(opponentRight.id)} />
                {compact ? (
                  <div style={styles.compactPlayRow}>
                    <CompactPlay cards={currentRoom.currentRoundPlays?.[rightSeat]?.cards} passed={passedSeats.has(rightSeat) && !currentRoom.currentRoundPlays?.[rightSeat]} />
                  </div>
                ) : (
                  <div style={styles.oppPlayRow}>
                    {passedSeats.has(rightSeat) && !currentRoom.currentRoundPlays?.[rightSeat] ? (
                      <div style={{ color: '#aaa', fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>过</div>
                    ) : (
                      <RoundPlayInline play={currentRoom.currentRoundPlays?.[rightSeat]} currentLevel={currentLevel} small />
                    )}
                  </div>
                )}
              </div>
            ) : <EmptySeat seat={rightSeat} />}
          </div>
        </div>

        {/* Bottom: my play + hand */}
        <div style={{ ...styles.myArea, ...(compact ? { gap: '5px' } : {}) }}>
          {/* My play this round — fixed height; cleared when it's my turn */}
          {compact ? (
            <div style={styles.compactPlayRow}>
              {!isMyTurn && <CompactPlay cards={currentRoom.currentRoundPlays?.[mySeat]?.cards} passed={passedSeats.has(mySeat) && !currentRoom.currentRoundPlays?.[mySeat]} label="我" />}
            </div>
          ) : (
            <div style={styles.myPlayRow}>
              {!isMyTurn && (currentRoom.currentRoundPlays?.[mySeat] ? (
                <RoundPlayInline play={currentRoom.currentRoundPlays[mySeat]} currentLevel={currentLevel} label="我" small />
              ) : passedSeats.has(mySeat) ? (
                <div style={{ color: '#aaa', fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>我：过</div>
              ) : null)}
            </div>
          )}

          {/* My info */}
          <div style={styles.myInfo}>
            <span style={styles.myName}>{me?.name ?? '我'} ({SEAT_LABELS[mySeat]})</span>
            <span style={styles.myCardCount}>{myHand.length} 张</span>
            {finishedPlayers.has(playerId) && <span style={styles.finishedBadge}>已出完</span>}
          </div>

          {/* Hand — fan layout */}
          <div style={{ ...styles.handScroll, ...(compact ? { minHeight: '76px', padding: '0 8px' } : {}) }}>
            <div style={{
              position: 'relative',
              height: compact ? '76px' : '110px',
              width: compact
                ? `${Math.max(44, (myHand.length - 1) * 18 + 44 + selectedIds.size * 26)}px`
                : `${Math.max(54, (myHand.length - 1) * 23 + 54 + selectedIds.size * 30)}px`,
            }}>
              {myHand.map((card, i) => {
                const overlap = compact ? 18 : 23;
                const selOffset = compact ? 26 : 30;
                const extraOffset = myHand.slice(0, i).filter(c => selectedIds.has(c.id)).length * selOffset;
                return (
                <div
                  key={card.id}
                  style={{
                    position: 'absolute',
                    left: `${i * overlap + extraOffset}px`,
                    bottom: 0,
                    zIndex: selectedIds.has(card.id) ? 200 : i + 1,
                    transition: 'left 0.1s',
                  }}
                >
                  <CardComponent
                    card={card}
                    selected={selectedIds.has(card.id)}
                    onClick={() => toggleCard(card.id)}
                    isWildcard={isWildcard(card, currentLevel)}
                    small={compact}
                  />
                </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          {(() => {
            const isManaged = (currentRoom.managedPlayerIds ?? []).includes(playerId);
            return (
              <div style={{ ...styles.actions, ...(compact ? { gap: '6px' } : {}) }}>
                {!isManaged && (
                  <>
                    <button
                      style={{ ...styles.actionBtn, ...styles.clearBtn, ...(compact ? { padding: '4px 12px', fontSize: '0.88rem' } : {}) }}
                      onClick={() => setSelectedIds(new Set())}
                      disabled={selectedIds.size === 0}
                    >
                      取消
                    </button>
                    {canPass && (
                      <button style={{ ...styles.actionBtn, ...styles.passBtn, ...(compact ? { padding: '4px 12px', fontSize: '0.88rem' } : {}) }} onClick={handlePass}>
                        过
                      </button>
                    )}
                    <button
                      style={{
                        ...styles.actionBtn,
                        ...styles.playBtn,
                        ...(compact ? { padding: '4px 12px', fontSize: '0.88rem' } : {}),
                        ...(!isMyTurn || selectedIds.size === 0 ? styles.disabledBtn : {}),
                      }}
                      onClick={handlePlay}
                      disabled={!isMyTurn || selectedIds.size === 0}
                    >
                      出牌 {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                    </button>
                    <button
                      style={{ ...styles.actionBtn, ...styles.hintBtn, ...(compact ? { padding: '6px 12px', fontSize: '0.88rem' } : {}), ...(!isMyTurn ? styles.disabledBtn : {}) }}
                      onClick={() => socket.emit(SOCKET_EVENTS.GET_HINT)}
                      disabled={!isMyTurn}
                    >
                      提示
                    </button>
                  </>
                )}
                {isManaged && (
                  <div style={{ ...styles.managedBanner, ...(compact ? { fontSize: '0.78rem', padding: '4px 10px' } : {}) }}>托管中，系统自动出牌</div>
                )}
                <button
                  style={{ ...styles.actionBtn, ...(isManaged ? styles.managedActiveBtn : styles.managedBtn), ...(compact ? { padding: '4px 12px', fontSize: '0.85rem' } : {}) }}
                  onClick={() => socket.emit(SOCKET_EVENTS.TOGGLE_MANAGE)}
                >
                  {isManaged ? '取消托管' : '托管'}
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Hand type selection modal */}
      {handTypeChoices && (
        <div style={modalStyles.overlay}>
          <div style={{ ...modalStyles.modal, ...(compact ? { padding: '14px 16px', gap: '10px', minWidth: '220px' } : {}) }}>
            <div style={{ ...modalStyles.title, ...(compact ? { fontSize: '0.95rem' } : {}) }}>选择牌型</div>
            {!compact && <div style={modalStyles.subtitle}>这手牌有多种出法，请选择：</div>}
            <div style={{ ...modalStyles.choices, ...(compact ? { gap: '6px' } : {}) }}>
              {handTypeChoices.map((hr) => (
                <button
                  key={hr.type}
                  style={{ ...modalStyles.choiceBtn, ...(compact ? { padding: '8px 10px', fontSize: '0.88rem' } : {}), ...(chosenType === hr.type ? { border: '2px solid #ffd700', background: 'rgba(255,215,0,0.15)' } : {}) }}
                  onClick={() => setChosenType(hr.type)}
                >
                  {handTypeLabel(hr.type)}
                  {isBomb(hr) && <span style={modalStyles.bombTag}>炸弹</span>}
                </button>
              ))}
            </div>
            <button
              style={{ ...modalStyles.choiceBtn, ...(compact ? { padding: '8px 10px', fontSize: '0.88rem' } : {}), background: chosenType ? 'linear-gradient(135deg, #ffd700, #ffb300)' : 'rgba(255,255,255,0.05)', color: chosenType ? '#1a1a1a' : '#666', justifyContent: 'center', opacity: chosenType ? 1 : 0.5 }}
              disabled={!chosenType}
              onClick={() => chosenType && handleChooseType(chosenType)}
            >
              确认出牌
            </button>
            <button style={{ ...modalStyles.cancelBtn, ...(compact ? { padding: '6px', fontSize: '0.85rem' } : {}) }} onClick={cancelChooseType}>取消</button>
          </div>
        </div>
      )}

      {/* Game result overlay */}
      {gameResult && (() => {
        const winTeamName = gameResult.winningTeam === 0 ? 'A队' : 'B队';
        const aceTeam = gameResult.aceTeam;
        const aceTeamName = aceTeam !== null ? (aceTeam === 0 ? 'A队' : 'B队') : '';
        const otherTeamName = aceTeam !== null ? (aceTeam === 0 ? 'B队' : 'A队') : '';
        const aceFailCount = aceTeam !== null ? gameResult.aceFailures[aceTeam] : 0;
        const failOrdinal = aceFailCount === 1 ? '一' : aceFailCount === 2 ? '二' : '三';

        let title = '';
        let subtitle = '';

        if (gameResult.matchWon) {
          title = `🏆 ${winTeamName} 比赛胜利！`;
          subtitle = '';
        } else if (aceTeam !== null && gameResult.aceTeamFailed) {
          const aceWonThisRound = gameResult.winningTeam === aceTeam; // 升1
          const otherTeam = (1 - aceTeam) as 0 | 1;
          const otherTeamNewLvl = gameResult.newLevels[otherTeam];
          const otherTeamNewLvlLabel = levelLabels[otherTeamNewLvl - 2] ?? 'A';
          const nextRoundDesc = aceWonThisRound
            ? `下盘 ${aceTeamName} 继续打A`
            : `下盘 ${otherTeamName} 打${otherTeamNewLvl === 14 ? 'A' : otherTeamNewLvlLabel}`;
          if (aceFailCount === 0) {
            title = aceWonThisRound ? `${aceTeamName} 获胜（升1）` : `${otherTeamName} 获胜（升${gameResult.levelAdvance}级到${otherTeamNewLvlLabel}）`;
            subtitle = `${aceTeamName} 打A三次失败，退回2级`;
          } else {
            title = aceWonThisRound ? `${aceTeamName} 获胜（升1）` : `${otherTeamName} 获胜（升${gameResult.levelAdvance}级到${otherTeamNewLvlLabel}）`;
            subtitle = `${aceTeamName} 打A第${failOrdinal}次失败 · ${nextRoundDesc}`;
          }
        } else if (aceTeam === null) {
          const newLvlLabel = levelLabels[gameResult.newLevels[gameResult.winningTeam] - 2] ?? 'A';
          title = `${winTeamName} 获胜`;
          subtitle = `升${gameResult.levelAdvance}级，新级牌：${newLvlLabel}`;
        } else {
          title = `${winTeamName} 获胜`;
          subtitle = '';
        }

        return (
        <div style={overlayStyles.overlay}>
          <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '14px 16px', gap: '8px', minWidth: '240px' } : {}) }}>
            <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>{title}</div>
            <div style={{ ...overlayStyles.levelAdvance, ...(compact ? { fontSize: '0.9rem' } : {}) }}>{subtitle}</div>
            <div style={overlayStyles.positions}>
              {gameResult.finishPositions.map((fp) => (
                <div key={fp.playerId} style={overlayStyles.positionRow}>
                  <span style={overlayStyles.posNum}>第{fp.position}名</span>
                  <span style={overlayStyles.posName}>{fp.name}</span>
                </div>
              ))}
            </div>
            {gameResult.matchWon ? (
              <button
                style={{ ...modalStyles.choiceBtn, ...(compact ? { padding: '8px 10px', fontSize: '0.88rem' } : {}), marginTop: '8px', width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #ffd700, #ffb300)', color: '#1a1a1a' }}
                onClick={() => socket.emit(SOCKET_EVENTS.RESET_ROOM)}
              >
                返回房间
              </button>
            ) : (
              <>
                <button
                  style={{ ...modalStyles.choiceBtn, ...(compact ? { padding: '8px 10px', fontSize: '0.88rem' } : {}), marginTop: '8px', width: '100%', justifyContent: 'center', opacity: me?.isReady ? 0.5 : 1 }}
                  onClick={() => socket.emit(SOCKET_EVENTS.PLAYER_READY)}
                >
                  {me?.isReady ? '已准备 ✓' : '准备下一盘'}
                </button>
                <div style={{ ...overlayStyles.hint, ...(compact ? { fontSize: '0.75rem' } : {}) }}>
                  {currentRoom.players.filter((p) => p.isReady).length} / 4 人已准备
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* Tribute reveal overlay */}
      {tributeReveal && (
        <div style={overlayStyles.overlay}>
          <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
            <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>进贡 / 还贡</div>
            {tributeReveal.map((e, i) => (
              <div key={i} style={{ width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: compact ? '6px 10px' : '10px 16px', marginBottom: compact ? '4px' : '10px', display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: '#aaa', fontSize: compact ? '0.78rem' : '0.85rem' }}>{e.fromName} → {e.toName}</span>
                </div>
                <div style={{ display: 'flex', gap: compact ? '12px' : '20px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <span style={{ color: '#ff9800', fontSize: compact ? '0.7rem' : '0.75rem' }}>进贡</span>
                    {e.tributeCard ? <CardComponent card={e.tributeCard} small={compact} isWildcard={isWildcard(e.tributeCard, currentLevel)} /> : <span style={{ color: '#555' }}>—</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <span style={{ color: '#4fc3f7', fontSize: compact ? '0.7rem' : '0.75rem' }}>还贡</span>
                    {e.returnCard ? <CardComponent card={e.returnCard} small={compact} isWildcard={isWildcard(e.returnCard, currentLevel)} /> : <span style={{ color: '#555' }}>—</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dice rolling overlay */}
      {(currentRoom.phase === 'DICE_ROLLING' || diceResult) && !diceOverlayDone && (() => {
        const tiedIds = currentRoom.diceTiedIds ?? [];
        const isRerolling = tiedIds.length > 0 && (currentRoom.isRerollRound ?? false);
        const isShowingTie = tiedIds.length > 0 && !isRerolling;
        const iAmTied = tiedIds.includes(playerId);
        return (
        <div style={overlayStyles.overlay}>
          <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px', minWidth: '260px' } : {}) }}>
            <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>{isShowingTie ? '平局！' : isRerolling ? '平局！再投一次' : '掷骰子决定先手'}</div>
            {(isShowingTie || isRerolling) && (
              <div style={{ color: '#ff9800', fontSize: compact ? '0.75rem' : '0.85rem', marginBottom: '2px' }}>
                {`${tiedIds.map((id: string) => currentRoom.players.find(p => p.id === id)?.name ?? id).join(' 和 ')} 平局${isShowingTie ? '，稍后重新掷骰' : '，需要重新掷骰'}`}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '5px' : '10px', width: '100%' }}>
              {(diceResult ? diceResult.rolls.slice().sort((a, b) => a.seat - b.seat) : currentRoom.players.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)).map(p => ({ playerId: p.id, seat: p.seat ?? 0, name: p.name, roll: currentRoom.diceRolls?.[p.id] }))).map((r) => {
                const isWinner = diceResult && r.seat === diceResult.winningSeat;
                const rPlayerId = 'playerId' in r ? r.playerId : '';
                const isTiedPlayer = tiedIds.includes(rPlayerId);
                const roll = 'roll' in r ? r.roll : currentRoom.diceRolls?.[rPlayerId];
                return (
                  <div key={r.seat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: compact ? '4px 10px' : '8px 16px', background: isWinner ? 'rgba(255,215,0,0.15)' : isTiedPlayer ? 'rgba(255,152,0,0.12)' : 'rgba(255,255,255,0.06)', borderRadius: '8px', border: isWinner ? '1px solid rgba(255,215,0,0.5)' : isTiedPlayer ? '1px solid rgba(255,152,0,0.6)' : '1px solid transparent' }}>
                    <span style={{ color: isWinner ? '#ffd700' : isTiedPlayer ? '#ff9800' : '#eee', fontWeight: isWinner || isTiedPlayer ? 700 : 400, fontSize: compact ? '0.82rem' : undefined }}>
                      {r.name} ({SEAT_LABELS[r.seat]}){isWinner ? ' 👑 先出！' : isTiedPlayer ? ' 🔁' : ''}
                    </span>
                    <span style={{ color: roll !== undefined ? (isTiedPlayer ? '#ff9800' : '#ffd700') : '#555', fontWeight: 700, fontSize: compact ? '1rem' : '1.2rem' }}>
                      {roll !== undefined ? `🎲 ${roll}` : '？'}
                    </span>
                  </div>
                );
              })}
            </div>
            {diceResult ? (
              <button
                style={{ ...modalStyles.choiceBtn, marginTop: '12px', width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #ffd700, #ffb300)', color: '#1a1a1a' }}
                onClick={() => { setDiceOverlayDone(true); setDiceResult(null); }}
              >
                明白了，开始游戏！
              </button>
            ) : isShowingTie ? (
              <div style={{ ...overlayStyles.hint, color: '#ff9800' }}>平局结果展示中...</div>
            ) : currentRoom.diceRolls?.[playerId] === undefined ? (
              <button
                style={{ ...modalStyles.choiceBtn, marginTop: '8px', width: '100%', justifyContent: 'center', background: iAmTied ? 'linear-gradient(135deg, #ff9800, #f57c00)' : 'linear-gradient(135deg, #ffd700, #ffb300)', color: '#1a1a1a' }}
                onClick={() => socket.emit(SOCKET_EVENTS.ROLL_DICE)}
              >
                🎲 {isRerolling ? '重新掷骰子！' : '掷骰子！'}
              </button>
            ) : (
              <div style={overlayStyles.hint}>等待其他玩家掷骰子...</div>
            )}
          </div>
        </div>
        );
      })()}

      {/* 抗贡 overlay */}
      {tributeState?.skipTribute && tributeState.bigJokerHolders && (
        <div style={overlayStyles.overlay}>
          <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
            <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>抗贡！</div>
            <div style={{ color: '#ffd700', fontSize: compact ? '0.78rem' : '0.95rem', marginBottom: compact ? '4px' : '12px' }}>免除进贡，即将开始新游戏...</div>
            {tributeState.bigJokerHolders.map((h) => (
              <div key={h.playerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: compact ? '5px 10px' : '8px 16px', marginBottom: compact ? '4px' : '8px', width: '100%' }}>
                <span style={{ color: '#eee', fontSize: compact ? '0.85rem' : undefined }}>{h.name}</span>
                <span style={{ color: '#ffd700', fontWeight: 700, fontSize: compact ? '0.9rem' : '1.1rem' }}>
                  {Array(h.count).fill('大王').join(' + ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tribute overlays */}
      {tributeState && !tributeState.skipTribute && (() => {
        const isManaged = (currentRoom.managedPlayerIds ?? []).includes(playerId);
        if (isManaged) {
          return (
            <div style={overlayStyles.overlay}>
              <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
                <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>进贡/还贡</div>
                <div style={{ color: '#81c784', fontSize: compact ? '0.78rem' : '0.95rem' }}>托管中，系统自动处理...</div>
              </div>
            </div>
          );
        }

        // Phase 1: I need to give tribute
        const giveEntry = tributeState.entries.find((e) => e.fromPlayerId === playerId && !e.tributeGiven);
        if (giveEntry) {
          // Jokers (大王/小王) CAN be tributed; only 万能牌 excluded
          const eligible = myHand.filter((c) => !isWildcard(c, currentLevel));
          const maxVal = eligible.length > 0 ? Math.max(...eligible.map((c) => getGameValue(c, currentLevel))) : -1;
          const options = eligible.filter((c) => getGameValue(c, currentLevel) === maxVal);
          const receiver = currentRoom.players.find((p) => p.id === giveEntry.toPlayerId);
          return (
            <div style={overlayStyles.overlay}>
              <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px', minWidth: '260px' } : {}) }}>
                <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>进贡</div>
                <div style={{ ...overlayStyles.hint, fontSize: compact ? '0.75rem' : undefined }}>选一张牌进贡给 {receiver?.name}（必须是最大的牌）</div>
                {compact ? (
                  <TributeBadgeHand
                    cards={myHand}
                    selectedId={Array.from(selectedIds)[0]}
                    isEligible={(c) => options.some(o => o.id === c.id)}
                    onSelect={(id) => setSelectedIds(new Set([id]))}
                  />
                ) : (
                  <div style={tributeStyles.handRow}>
                    {myHand.map((c) => {
                      const canTribute = options.some(o => o.id === c.id);
                      return (
                        <div key={c.id} style={{ opacity: canTribute ? 1 : 0.35, flexShrink: 0 }}>
                          <CardComponent card={c} selected={selectedIds.has(c.id)}
                            onClick={() => canTribute ? setSelectedIds(new Set([c.id])) : undefined}
                            isWildcard={isWildcard(c, currentLevel)} />
                        </div>
                      );
                    })}
                  </div>
                )}
                {options.length === 0 && <div style={{ color: '#81c784', fontSize: compact ? '0.8rem' : undefined }}>没有可进贡的牌（全是王或万能牌）</div>}
                <button
                  style={{ ...modalStyles.choiceBtn, marginTop: compact ? '6px' : '12px', opacity: selectedIds.size === 0 && options.length > 0 ? 0.5 : 1 }}
                  disabled={options.length > 0 && selectedIds.size === 0}
                  onClick={() => {
                    const cardId = Array.from(selectedIds)[0];
                    if (cardId) { socket.emit(SOCKET_EVENTS.TRIBUTE_CARD, { cardId }); setSelectedIds(new Set()); }
                  }}
                >确认进贡</button>
              </div>
            </div>
          );
        }

        // Phase 2: I received tribute and need to return a card
        const returnEntry = tributeState.entries.find((e) => e.toPlayerId === playerId && e.tributeGiven && !e.done);
        if (returnEntry) {
          const giver = currentRoom.players.find((p) => p.id === returnEntry.fromPlayerId);
          return (
            <div style={overlayStyles.overlay}>
              <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px', minWidth: '260px' } : {}) }}>
                <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>还贡</div>
                <div style={{ ...overlayStyles.hint, fontSize: compact ? '0.75rem' : undefined }}>收到 {giver?.name} 进贡。选一张 10 或以下的牌还给对方</div>
                {returnEntry.tributeCard && (
                  <div style={tributeStyles.tributeCard}>
                    收到的贡牌：<CardComponent card={returnEntry.tributeCard} small={compact} isWildcard={isWildcard(returnEntry.tributeCard, currentLevel)} />
                  </div>
                )}
                {compact ? (
                  <TributeBadgeHand
                    cards={myHand}
                    selectedId={Array.from(selectedIds)[0]}
                    isEligible={(c) => getGameValue(c, currentLevel) <= 10}
                    onSelect={(id) => setSelectedIds(new Set([id]))}
                  />
                ) : (
                  <div style={tributeStyles.handRow}>
                    {myHand.map((c) => {
                      const canReturn = getGameValue(c, currentLevel) <= 10;
                      return (
                        <div key={c.id} style={{ opacity: canReturn ? 1 : 0.35, flexShrink: 0 }}>
                          <CardComponent card={c} selected={selectedIds.has(c.id)}
                            onClick={() => canReturn ? setSelectedIds(new Set([c.id])) : undefined}
                            isWildcard={isWildcard(c, currentLevel)} />
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  style={{ ...modalStyles.choiceBtn, marginTop: compact ? '6px' : '12px', opacity: selectedIds.size === 0 ? 0.5 : 1 }}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    const cardId = Array.from(selectedIds)[0];
                    if (cardId) { socket.emit(SOCKET_EVENTS.TRIBUTE_RETURN_CARD, { cardId }); setSelectedIds(new Set()); }
                  }}
                >确认还贡</button>
              </div>
            </div>
          );
        }

        // Phase 3: Grab phase (抢贡) — I'm a tributer and need to grab a return card
        if (tributeState.grabPhase) {
          const myGrabEntry = tributeState.entries.find((e) => e.fromPlayerId === playerId && !e.done);
          if (myGrabEntry) {
            return (
              <div style={overlayStyles.overlay}>
                <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
                  <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>抢贡！</div>
                  <div style={{ ...overlayStyles.hint, fontSize: compact ? '0.75rem' : undefined }}>选一张你想要的还贡牌（后抢到的人先出第一手牌）</div>
                  <div style={{ ...tributeStyles.handRow, ...(compact ? { flexWrap: 'nowrap', overflowX: 'auto', maxHeight: '80px' } : {}) }}>
                    {tributeState.pendingReturns.map((pr) => (
                      <div key={pr.card.id} style={{ flexShrink: 0 }}>
                        <CardComponent card={pr.card} small={compact} selected={selectedIds.has(pr.card.id)}
                          onClick={() => setSelectedIds(new Set([pr.card.id]))}
                          isWildcard={isWildcard(pr.card, currentLevel)} />
                        <div style={{ color: '#aaa', fontSize: '0.7rem', textAlign: 'center', marginTop: '2px' }}>
                          来自{currentRoom.players.find(p => p.id === pr.receiverId)?.name}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    style={{ ...modalStyles.choiceBtn, marginTop: compact ? '6px' : '12px', opacity: selectedIds.size === 0 ? 0.5 : 1 }}
                    disabled={selectedIds.size === 0}
                    onClick={() => {
                      const cardId = Array.from(selectedIds)[0];
                      if (cardId) { socket.emit(SOCKET_EVENTS.GRAB_TRIBUTE, { cardId }); setSelectedIds(new Set()); }
                    }}
                  >抢！</button>
                </div>
              </div>
            );
          }
          // Watching grab phase
          return (
            <div style={overlayStyles.overlay}>
              <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
                <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>抢贡中...</div>
                <div style={{ ...overlayStyles.hint, fontSize: compact ? '0.75rem' : undefined }}>等待双方抢牌，后抢到牌的人先出</div>
                <div style={{ ...tributeStyles.handRow, ...(compact ? { flexWrap: 'nowrap', overflowX: 'auto', maxHeight: '80px' } : {}) }}>
                  {tributeState.pendingReturns.map((pr) => (
                    <CardComponent key={pr.card.id} card={pr.card} small={compact} isWildcard={isWildcard(pr.card, currentLevel)} />
                  ))}
                </div>
              </div>
            </div>
          );
        }

        // Watching: show progress
        const allDone = tributeState.entries.every((e) => e.done);
        if (!allDone) {
          return (
            <div style={overlayStyles.overlay}>
              <div style={{ ...overlayStyles.panel, ...(compact ? { padding: '12px 14px', gap: '8px' } : {}) }}>
                <div style={{ ...overlayStyles.title, ...(compact ? { fontSize: '1.1rem' } : {}) }}>进贡中...</div>
                {tributeState.entries.map((e, i) => {
                  const giver = currentRoom.players.find((p) => p.id === e.fromPlayerId);
                  const recv = currentRoom.players.find((p) => p.id === e.toPlayerId);
                  return (
                    <div key={i} style={tributeStyles.tributeRow}>
                      <span style={{ color: '#aaa' }}>{giver?.name} → {recv?.name}</span>
                      {e.done ? <span style={{ color: '#81c784' }}>✓ 已完成</span>
                        : e.tributeGiven ? <span style={{ color: '#ffd700' }}>等待还贡...</span>
                        : <span style={{ color: '#aaa' }}>等待进贡...</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
};

const TributeBadgeHand: React.FC<{
  cards: Card[];
  selectedId?: string;
  isEligible?: (card: Card) => boolean;
  onSelect?: (cardId: string) => void;
}> = ({ cards, selectedId, isEligible, onSelect }) => (
  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
    {cards.map((c) => {
      const eligible = isEligible ? isEligible(c) : true;
      const selected = c.id === selectedId;
      const isRed = c.suit === Suit.HEART || c.suit === Suit.DIAMOND || (c.suit === Suit.JOKER && c.rank === 15);
      return (
        <span
          key={c.id}
          onClick={() => eligible && onSelect?.(c.id)}
          style={{
            background: selected ? 'rgba(255,215,0,0.92)' : 'rgba(255,255,255,0.92)',
            color: selected ? '#1a1a1a' : isRed ? '#c0392b' : '#1a1a1a',
            fontSize: '1.0rem',
            padding: '4px 9px',
            borderRadius: '5px',
            fontWeight: 700,
            lineHeight: 1.3,
            cursor: eligible && onSelect ? 'pointer' : 'default',
            opacity: eligible ? 1 : 0.28,
            border: selected ? '2px solid #ffd700' : '2px solid transparent',
            boxShadow: selected ? '0 2px 8px rgba(255,215,0,0.5)' : 'none',
            userSelect: 'none',
          }}
        >
          {getCardLabel(c)}
        </span>
      );
    })}
  </div>
);

function getCardLabel(card: Card): string {
  const rankLabels: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: '小', 15: '大' };
  const suitSymbols: Record<Suit, string> = { [Suit.SPADE]: '♠', [Suit.HEART]: '♥', [Suit.CLUB]: '♣', [Suit.DIAMOND]: '♦', [Suit.JOKER]: '' };
  return (rankLabels[card.rank] ?? String(card.rank)) + suitSymbols[card.suit];
}

const CompactPlay: React.FC<{ cards?: Card[]; passed?: boolean; label?: string }> = ({ cards, passed, label }) => {
  if (passed) return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      {label && <span style={{ color: '#888', fontSize: '0.72rem' }}>{label}</span>}
      <span style={{ color: '#888', fontSize: '0.72rem' }}>过</span>
    </div>
  );
  if (!cards || cards.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
      {label && <span style={{ color: '#888', fontSize: '0.72rem', marginRight: '2px' }}>{label}</span>}
      {cards.slice(0, 6).map((c, i) => {
        const isRed = c.suit === Suit.HEART || c.suit === Suit.DIAMOND || (c.suit === Suit.JOKER && c.rank === 15);
        return (
          <span key={i} style={{ background: 'rgba(255,255,255,0.88)', color: isRed ? '#c0392b' : '#1a1a1a', fontSize: '0.82rem', padding: '1px 4px', borderRadius: '2px', fontWeight: 700, lineHeight: '18px' }}>
            {getCardLabel(c)}
          </span>
        );
      })}
      {cards.length > 6 && <span style={{ color: '#aaa', fontSize: '0.78rem' }}>+{cards.length - 6}</span>}
    </div>
  );
};

function handTypeLabel(type: HandType): string {
  const labels: Record<HandType, string> = {
    [HandType.SINGLE]: '单张',
    [HandType.PAIR]: '对子',
    [HandType.TRIPLE]: '三张',
    [HandType.STRAIGHT]: '顺子',
    [HandType.CONSECUTIVE_PAIRS]: '连对',
    [HandType.CONSECUTIVE_TRIPLES]: '三顺',
    [HandType.TRIPLE_PAIR]: '三带对',
    [HandType.BOMB_QUAD]: '四炸',
    [HandType.BOMB_5]: '五炸',
    [HandType.BOMB_6]: '六炸',
    [HandType.BOMB_7]: '七炸',
    [HandType.BOMB_8]: '八炸',
    [HandType.STRAIGHT_FLUSH]: '同花顺',
    [HandType.JOKER_BOMB]: '四王炸',
  };
  return labels[type] ?? type;
}

const RoundPlayInline: React.FC<{
  play?: { cards: Card[]; hand: HandResult };
  currentLevel: number;
  label?: string;
  small?: boolean;
}> = ({ play, currentLevel, label, small = false }) => {
  if (!play) return null;
  return (
    <div style={roundPlayStyles.container}>
      {label && <span style={roundPlayStyles.label}>{label}</span>}
      <div style={roundPlayStyles.cards}>
        {[...play.cards].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel)).map((c) => (
          <CardComponent key={c.id} card={c} small={small} isWildcard={isWildcard(c, currentLevel)} />
        ))}
      </div>
    </div>
  );
};

const roundPlayStyles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginTop: '4px' },
  label: { color: '#888', fontSize: '0.7rem', flexShrink: 0 },
  cards: { display: 'flex', gap: '3px', flexWrap: 'wrap' },
};

const OpponentDisplay: React.FC<{
  player: { id: string; name: string; seat: PlayerSeat | null; teamId: number | null };
  handCount: number;
  isCurrentTurn: boolean;
  isFinished: boolean;
  isManaged: boolean;
  isDisconnected: boolean;
  compact?: boolean;
}> = ({ player, handCount, isCurrentTurn, isFinished, isManaged, isDisconnected, compact }) => (
  <div style={{ ...oppStyles.container, ...(compact ? { padding: '5px 10px', minWidth: '100px' } : {}), ...(isCurrentTurn ? oppStyles.active : {}), ...(isDisconnected ? oppStyles.disconnected : {}) }}>
    <div style={{ ...oppStyles.name, ...(compact ? { fontSize: '0.75rem', marginBottom: '2px' } : {}) }}>
      {player.name} ({SEAT_LABELS[player.seat ?? 0]})
      {compact && !isFinished && <span style={{ color: '#4fc3f7', fontWeight: 700, marginLeft: '5px' }}>牌数：{handCount <= 10 ? handCount : '?'}</span>}
    </div>
    {isFinished ? (
      <div style={{ ...oppStyles.finished, ...(compact ? { fontSize: '0.72rem' } : {}) }}>已出完 🎉</div>
    ) : (
      !compact && <div style={oppStyles.cardCount}>{handCount <= 10 ? `牌数：${handCount}` : '牌数：？'}</div>
    )}
    <div style={{ height: '20px', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      {isCurrentTurn && !isDisconnected && <span style={oppStyles.turnBadge}>出牌中</span>}
      {isDisconnected && <span style={oppStyles.disconnectedBadge}>断线中</span>}
      {isManaged && !isDisconnected && <span style={oppStyles.managedBadge}>托管</span>}
    </div>
  </div>
);

const EmptySeat: React.FC<{ seat: PlayerSeat }> = ({ seat }) => (
  <div style={oppStyles.empty}>空位 ({SEAT_LABELS[seat]})</div>
);

const oppStyles: Record<string, React.CSSProperties> = {
  container: { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 14px', textAlign: 'center', minWidth: '90px' },
  active: { border: '2px solid #ffd700', background: 'rgba(255,215,0,0.1)' },
  name: { color: '#eee', fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' },
  cardCount: { color: '#4fc3f7', fontSize: '1.1rem', fontWeight: 700 },
  finished: { color: '#81c784', fontSize: '0.85rem', fontWeight: 600 },
  turnBadge: { background: '#ffd700', color: '#1a1a1a', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px' },
  managedBadge: { background: 'rgba(100,180,255,0.2)', color: '#90caf9', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, padding: '1px 5px', border: '1px solid rgba(100,180,255,0.35)' },
  disconnected: { opacity: 0.6, border: '1px solid rgba(255,100,100,0.4)' },
  disconnectedBadge: { background: 'rgba(255,80,80,0.2)', color: '#ef9a9a', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, padding: '1px 5px', border: '1px solid rgba(255,80,80,0.4)' },
  empty: { color: '#555', fontSize: '0.85rem', padding: '20px' },
};

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100dvh', minHeight: '-webkit-fill-available', background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.1)', gap: '8px' },
  headerInfo: { color: '#ffd700', fontSize: '0.85rem', fontWeight: 600, flexShrink: 0 },
  headerLevels: { display: 'flex', gap: '12px', flex: 1, justifyContent: 'center' },
  teamLevel: { color: '#aaa', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)' },
  teamLevelMine: { color: '#ffd700', fontWeight: 700, background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.3)' },
  teamLevelPlaying: { border: '1px solid rgba(255,215,0,0.2)' },
  leaveBtn: { background: 'transparent', border: '1px solid #555', color: '#aaa', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '0.8rem' },
  table: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px', gap: '8px' },
  topArea: { display: 'flex', justifyContent: 'center', flexDirection: 'column', alignItems: 'center', gap: '0', height: '180px' },
  opponentWithPlay: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0', height: '180px' },
  middleRow: { display: 'flex', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '800px', flex: 1 },
  sideArea: { display: 'flex', alignItems: 'center', minWidth: '100px' },
  centerArea: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '160px', background: 'rgba(0,0,0,0.2)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)' },
  roundPlaysGrid: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', padding: '8px', overflowY: 'auto', maxHeight: '200px' },
  roundPlayEntry: { display: 'flex', alignItems: 'center', gap: '8px' },
  roundPlayName: { color: '#aaa', fontSize: '0.75rem', minWidth: '40px', textAlign: 'right', flexShrink: 0 },
  roundPlayCards: { display: 'flex', gap: '3px', flexWrap: 'wrap' },
  noLastPlay: { color: '#666', fontSize: '0.95rem' },
  oppPlayRow: { height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  compactPlayRow: { height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  myPlayRow: { height: '80px', display: 'flex', alignItems: 'center' },
  turnIndicator: { marginTop: '8px', color: '#ffd700', fontWeight: 700, fontSize: '1.5rem', textShadow: '0 0 12px rgba(255,215,0,0.8)', letterSpacing: '0.02em' },
  myArea: { width: '100%', maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '8px' },
  myInfo: { display: 'flex', alignItems: 'center', gap: '12px' },
  myName: { color: '#ffd700', fontWeight: 600, fontSize: '0.9rem' },
  myCardCount: { color: '#aaa', fontSize: '0.85rem' },
  finishedBadge: { background: '#81c784', color: '#1a1a1a', borderRadius: '4px', padding: '2px 8px', fontSize: '0.8rem', fontWeight: 700 },
  handScroll: { overflowX: 'auto', padding: '8px 8px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', minHeight: '118px', display: 'flex', justifyContent: 'center' },
  actions: { display: 'flex', gap: '10px', justifyContent: 'center' },
  actionBtn: { padding: '10px 28px', borderRadius: '8px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', border: 'none', transition: 'opacity 0.2s' },
  clearBtn: { background: 'rgba(255,255,255,0.1)', color: '#ccc' },
  passBtn: { background: 'rgba(100,100,255,0.3)', color: '#aad4ff' },
  playBtn: { background: 'linear-gradient(135deg, #ffd700, #ffb300)', color: '#1a1a1a' },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  managedBtn: { background: 'rgba(100,180,255,0.15)', color: '#90caf9', padding: '10px 18px', fontSize: '0.85rem' },
  managedActiveBtn: { background: 'rgba(100,200,100,0.25)', color: '#81c784', padding: '10px 18px', fontSize: '0.85rem' },
  managedBanner: { color: '#81c784', fontSize: '0.85rem', padding: '8px 16px', background: 'rgba(100,200,100,0.12)', borderRadius: '8px', border: '1px solid rgba(100,200,100,0.25)' },
  hintBtn: { background: 'rgba(100,220,220,0.15)', color: '#80deea', padding: '10px 18px', fontSize: '0.9rem' },
};

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 },
  modal: { background: '#1a2a3a', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '16px', padding: '24px', minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '16px' },
  title: { color: '#ffd700', fontSize: '1.1rem', fontWeight: 700, textAlign: 'center' },
  subtitle: { color: '#aaa', fontSize: '0.85rem', textAlign: 'center' },
  choices: { display: 'flex', flexDirection: 'column', gap: '10px' },
  choiceBtn: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '12px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  bombTag: { background: '#e74c3c', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 },
  cancelBtn: { background: 'transparent', border: '1px solid #555', color: '#aaa', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontSize: '0.9rem' },
};

const overlayStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  panel: { background: '#1a2a3a', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', padding: '24px', minWidth: '280px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', textAlign: 'center' },
  title: { color: '#ffd700', fontSize: '1.4rem', fontWeight: 800 },
  levelAdvance: { color: '#81c784', fontSize: '1.1rem', fontWeight: 700 },
  positions: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' },
  positionRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' },
  posNum: { color: '#ffd700', fontWeight: 700 },
  posName: { color: '#eee' },
  hint: { color: '#888', fontSize: '0.85rem' },
};

const tributeStyles: Record<string, React.CSSProperties> = {
  tributeCard: { display: 'flex', alignItems: 'center', gap: '12px', color: '#aaa', fontSize: '0.9rem' },
  handRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', minHeight: '70px' },
  tributeRow: { display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '4px 0' },
};

export default GamePage;
