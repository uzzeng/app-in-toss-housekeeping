// "오늘" 날짜(YYYY-MM-DD)는 KST 자정 기준이어야 한다. new Date().toISOString()은 UTC 기준이라
// KST 00:00~08:59 사이에는 하루 이른 날짜가 나온다. 서버(occurrences의 todayKst)와 같은 방식.
export function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
