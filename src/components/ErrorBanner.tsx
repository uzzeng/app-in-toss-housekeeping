import { adaptive } from '@toss/tds-colors';

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 16px',
        marginBottom: 12,
        borderRadius: 12,
        background: adaptive.red50,
      }}
    >
      <span style={{ color: adaptive.red700, fontSize: 13 }}>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          flexShrink: 0,
          border: 'none',
          borderRadius: 8,
          padding: '6px 10px',
          background: adaptive.red100,
          color: adaptive.red700,
          fontSize: 13,
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
