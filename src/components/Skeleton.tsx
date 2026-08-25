import { adaptive } from '@toss/tds-colors';

// 로딩 중 뼈대를 보여주는 자리표시자 박스. 은은한 펄스 애니메이션은 index.css의 .skeleton-pulse.
export function Skeleton({
  width,
  height,
  borderRadius = 8,
  style,
}: {
  width: number | string;
  height: number | string;
  borderRadius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton-pulse"
      style={{ width, height, borderRadius, background: adaptive.grey100, ...style }}
    />
  );
}
