import { useEffect, useState } from 'react';
import { adaptive } from '@toss/tds-colors';

const SWEEP_FRAMES = ['/loading-sweep-1.png', '/loading-sweep-2.jpeg'];

export function SplashScreen() {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SWEEP_FRAMES.length);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        backgroundImage: 'url(/loading-background.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <img
        src={SWEEP_FRAMES[frameIndex]}
        alt=""
        aria-hidden={true}
        style={{ width: 160, aspectRatio: '1/1' }}
      />
      <div
        style={{
          width: 160,
          height: 4,
          borderRadius: 2,
          background: adaptive.greyOpacity200,
          overflow: 'hidden',
        }}
      >
        <div className="splash-progress-bar" />
      </div>
      <p style={{ margin: 0, fontSize: 14, color: adaptive.grey600 }}>집안일을 불러오는 중</p>
    </div>
  );
}
