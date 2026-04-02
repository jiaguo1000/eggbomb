import React from 'react';
import { Card, Suit } from '@eggbomb/shared';

interface CardProps {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  small?: boolean;
  isWildcard?: boolean;
}

function getRankLabel(rank: number): string {
  const labels: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: '小', 15: '大' };
  return labels[rank] ?? String(rank);
}

function getSuitSymbol(suit: Suit): string {
  return { [Suit.SPADE]: '♠', [Suit.HEART]: '♥', [Suit.CLUB]: '♣', [Suit.DIAMOND]: '♦', [Suit.JOKER]: '' }[suit] ?? '';
}

const JokerCenter: React.FC<{ isBig: boolean; small?: boolean }> = ({ isBig, small }) => {
  if (small) {
    return (
      <>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '1rem', lineHeight: 1, filter: isBig ? 'none' : 'grayscale(1)' }}>🃏</div>
        <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: '0.65rem', fontWeight: 700, color: isBig ? '#e74c3c' : '#555' }}>
          {isBig ? '大' : '小'}
        </div>
      </>
    );
  }
  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: '2rem', lineHeight: 1, filter: isBig ? 'none' : 'grayscale(1)' }}>🃏</span>
      <span style={{
        fontSize: '0.8rem',
        fontWeight: 800,
        letterSpacing: '0.05em',
        background: isBig ? 'linear-gradient(135deg, #e74c3c, #f39c12, #2ecc71, #3498db)' : 'none',
        WebkitBackgroundClip: isBig ? 'text' : undefined,
        WebkitTextFillColor: isBig ? 'transparent' : undefined,
        color: isBig ? undefined : '#555',
      }}>
        {isBig ? '大王' : '小王'}
      </span>
    </div>
  );
};

const CardComponent: React.FC<CardProps> = ({ card, selected, onClick, faceDown, small, isWildcard }) => {
  if (faceDown) {
    return (
      <div style={{ ...styles.card(small), ...styles.faceDown }}>
        <span style={{ fontSize: small ? '0.6rem' : '1rem', color: '#aaa' }}>🂠</span>
      </div>
    );
  }

  const isJoker = card.suit === Suit.JOKER;
  const isBigJoker = isJoker && card.rank === 15;
  const isRed = card.suit === Suit.HEART || card.suit === Suit.DIAMOND || isBigJoker;
  const rank = getRankLabel(card.rank);
  const suitSymbol = getSuitSymbol(card.suit);

  return (
    <div
      style={{
        ...styles.card(small),
        ...(isRed ? styles.red : styles.black),
        ...(selected ? styles.selected : {}),
        ...(isWildcard ? styles.wildcard : {}),
        ...(isJoker ? (isBigJoker ? styles.bigJokerCard : styles.smallJokerCard) : {}),
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      {isWildcard && <div style={styles.wildcardBadge}>万能</div>}
      {/* Corner label */}
      <div style={styles.corner(small)}>
        {isJoker ? (
          <div style={{ fontSize: small ? '0.6rem' : '0.85rem', fontWeight: 800, color: isBigJoker ? '#e74c3c' : '#555', lineHeight: 1 }}>
            {isBigJoker ? '大' : '小'}
          </div>
        ) : (
          <>
            <div style={styles.rankText(small)}>{rank}</div>
            <div style={styles.suitText(small)}>{suitSymbol}</div>
          </>
        )}
      </div>
      {/* Center */}
      {!small && (
        isJoker ? (
          <JokerCenter isBig={isBigJoker} />
        ) : (
          <div style={styles.center}>
            <span style={{ fontSize: '1.5rem' }}>{suitSymbol}</span>
          </div>
        )
      )}
      {small && isJoker && <JokerCenter isBig={isBigJoker} small />}
    </div>
  );
};

const styles = {
  card: (small?: boolean): React.CSSProperties => ({
    width: small ? '44px' : '64px',
    height: small ? '64px' : '90px',
    borderRadius: small ? '5px' : '6px',
    background: '#fff',
    border: '1px solid #ddd',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: small ? '3px 4px' : '4px 5px',
    position: 'relative',
    userSelect: 'none',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    flexShrink: 0,
    transition: 'transform 0.1s, box-shadow 0.1s',
  }),
  faceDown: {
    background: 'linear-gradient(135deg, #1a3a6e, #2a5298)',
    border: '1px solid #4a7acc',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  red: { color: '#c0392b' } as React.CSSProperties,
  black: { color: '#1a1a1a' } as React.CSSProperties,
  selected: {
    transform: 'translateY(-12px)',
    boxShadow: '0 4px 12px rgba(255,215,0,0.6)',
    border: '2px solid #ffd700',
  } as React.CSSProperties,
  wildcard: {
    background: 'linear-gradient(135deg, #fff9e6, #fffde7)',
    border: '2px solid #ff9800',
  } as React.CSSProperties,
  bigJokerCard: {
    background: 'linear-gradient(135deg, #fff5f5, #fff)',
    border: '1px solid #e74c3c',
  } as React.CSSProperties,
  smallJokerCard: {
    background: 'linear-gradient(135deg, #f5f5f5, #fff)',
    border: '1px solid #aaa',
  } as React.CSSProperties,
  wildcardBadge: {
    position: 'absolute',
    bottom: '3px',
    left: '3px',
    background: '#ff9800',
    color: '#fff',
    fontSize: '0.55rem',
    fontWeight: 700,
    padding: '1px 3px',
    borderRadius: '3px',
    lineHeight: 1,
  } as React.CSSProperties,
  corner: (_small?: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    lineHeight: 1.1,
  }),
  rankText: (small?: boolean): React.CSSProperties => ({
    fontSize: small ? '0.88rem' : '1.4rem',
    fontWeight: 700,
    lineHeight: 1,
  }),
  suitText: (small?: boolean): React.CSSProperties => ({
    fontSize: small ? '0.82rem' : '1.3rem',
    lineHeight: 1,
  }),
  center: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
};

export default CardComponent;
