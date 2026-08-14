import { useEffect, useState } from 'react';
import { Checkbox } from '@toss/tds-mobile';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import {
  fetchTodayOccurrences,
  fetchWeekOccurrences,
  setOccurrenceCompleted,
  type Occurrence,
} from '../lib/occurrences';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;
}

function groupByDate(occurrences: Occurrence[]): [string, Occurrence[]][] {
  const map = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const list = map.get(o.scheduled_date) ?? [];
    list.push(o);
    map.set(o.scheduled_date, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function MainPage() {
  const currentUser = useCurrentUser();
  const [today, setToday] = useState<Occurrence[]>([]);
  const [week, setWeek] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    setLoading(true);
    Promise.all([fetchTodayOccurrences(anonKey), fetchWeekOccurrences(anonKey)])
      .then(([todayList, weekList]) => {
        setToday(todayList);
        setWeek(weekList);
      })
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [anonKey]);

  function applyStatus(list: Occurrence[], id: string, status: Occurrence['status']): Occurrence[] {
    return list.map((o) => (o.id === id ? { ...o, status } : o));
  }

  async function handleToggle(occurrence: Occurrence) {
    if (!anonKey) return;
    const nextCompleted = occurrence.status !== 'done';
    const nextStatus: Occurrence['status'] = nextCompleted ? 'done' : 'pending';

    // 목록에서 제거/추가하지 않고, 같은 항목의 status만 낙관적으로 갱신
    setToday((prev) => applyStatus(prev, occurrence.id, nextStatus));
    try {
      await setOccurrenceCompleted(anonKey, occurrence.id, nextCompleted);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      // 실패 시 원복
      setToday((prev) => applyStatus(prev, occurrence.id, occurrence.status));
    }
  }

  if (currentUser.status === 'loading') {
    return <p style={{ padding: 16 }}>사용자 식별 중...</p>;
  }
  if (currentUser.status === 'error') {
    return (
      <div style={{ padding: 16 }}>
        <p>사용자 식별에 실패했어요: {currentUser.reason}</p>
        <p style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{currentUser.detail}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <>
          {/* 박스1: 오늘 할 일 */}
          <section style={{ border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
            {today.length === 0 ? (
              <p>오늘은 집안일이 없어요.</p>
            ) : (
              <>
                <p style={{ fontWeight: 'bold', marginBottom: 8 }}>
                  {(() => {
                    const remaining = today.filter((o) => o.status !== 'done').length;
                    return remaining === 0
                      ? '오늘 집안일을 모두 완료했습니다!'
                      : `오늘 해야할 일 ${remaining}개가 남았어요!`;
                  })()}
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {today.map((o) => {
                    const isDone = o.status === 'done';
                    return (
                      <li
                        key={o.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
                      >
                        <Checkbox.Circle checked={isDone} onCheckedChange={() => handleToggle(o)} />
                        <span style={{ color: isDone ? '#aaa' : undefined }}>{o.chores.name}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* 박스2: 앞으로 일주일 예정된 일 (보기 전용) */}
          <section style={{ border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
            <p style={{ fontWeight: 'bold', marginBottom: 8 }}>이번 주 예정</p>
            {week.length === 0 ? (
              <p style={{ color: '#888' }}>앞으로 일주일간 예정된 집안일이 없어요.</p>
            ) : (
              groupByDate(week).map(([date, items]) => (
                <div key={date} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, color: '#888' }}>{formatDateLabel(date)}</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {items.map((o) => (
                      <li key={o.id} style={{ padding: '4px 0' }}>
                        {o.chores.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
