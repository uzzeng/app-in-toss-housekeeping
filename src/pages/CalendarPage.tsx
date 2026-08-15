import { useEffect, useState } from 'react';
import { Button, Chip, ChipItem, Checkbox } from '@toss/tds-mobile';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { addManualOccurrence, fetchMonthOccurrences, setOccurrenceCompleted, type Occurrence } from '../lib/occurrences';
import { CHORE_TYPE_LABEL, fetchChores, type Chore } from '../lib/chores';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function toMonthParam(year: number, month0to11: number): string {
  return `${year}-${String(month0to11 + 1).padStart(2, '0')}`;
}

function displayDateOf(o: Occurrence): string {
  // PRD 규칙: 완료 항목은 completed_date 칸, 미완료 항목은 scheduled_date 칸에 표시
  return o.status === 'done' && o.completed_date ? o.completed_date : o.scheduled_date;
}

function formatSelectedDateLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY[d.getDay()]}요일`;
}

function buildMonthGrid(year: number, month0to11: number): (number | null)[][] {
  const firstDay = new Date(year, month0to11, 1);
  const daysInMonth = new Date(year, month0to11 + 1, 0).getDate();
  const startWeekday = firstDay.getDay();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function CalendarPage() {
  const currentUser = useCurrentUser();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month: 0-11
  });
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[]>([]);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [addingChoreId, setAddingChoreId] = useState<string | null>(null);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    setLoading(true);
    setSelectedDate(null);
    fetchMonthOccurrences(anonKey, toMonthParam(cursor.year, cursor.month))
      .then(setOccurrences)
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [anonKey, cursor]);

  useEffect(() => {
    if (!anonKey) return;
    fetchChores(anonKey)
      .then(setChores)
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)));
  }, [anonKey]);

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

  const byDate = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = displayDateOf(o);
    const list = byDate.get(key) ?? [];
    list.push(o);
    byDate.set(key, list);
  }

  const weeks = buildMonthGrid(cursor.year, cursor.month);

  async function handleAddManual(choreId: string) {
    if (!anonKey || !selectedDate) return;
    setAddingChoreId(choreId);
    try {
      const created = await addManualOccurrence(anonKey, choreId, selectedDate);
      setOccurrences((prev) => [...prev, created]);
      setShowAddPicker(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingChoreId(null);
    }
  }

  async function handleToggle(o: Occurrence) {
    if (!anonKey) return;
    const nextCompleted = o.status !== 'done';
    const nextStatus: Occurrence['status'] = nextCompleted ? 'done' : 'pending';
    const nextCompletedDate = nextCompleted ? new Date().toISOString().slice(0, 10) : null;

    // 완료 처리는 오늘 예정일이 아닌 날짜에도 발생할 수 있으므로(캘린더에서 과거 미완료 건 완료 처리 등)
    // 표시 기준 날짜(displayDateOf)가 바뀔 수 있다 — 목록을 새로 계산하기보다 그대로 두고 상태만 갱신한다.
    setOccurrences((prev) =>
      prev.map((item) =>
        item.id === o.id ? { ...item, status: nextStatus, completed_date: nextCompletedDate } : item,
      ),
    );
    try {
      await setOccurrenceCompleted(anonKey, o.id, nextCompleted);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setOccurrences((prev) =>
        prev.map((item) => (item.id === o.id ? { ...item, status: o.status, completed_date: o.completed_date } : item)),
      );
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))
          }
        >
          이전
        </button>
        <h1 style={{ margin: 0, fontSize: 18 }}>
          {cursor.year}년 {cursor.month + 1}월
        </h1>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))
          }
        >
          다음
        </button>
      </div>

      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {WEEKDAY.map((w) => (
                <th key={w} style={{ fontSize: 12, color: '#888', fontWeight: 'normal', padding: 4 }}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  if (day === null) return <td key={di} style={{ border: '1px solid #eee', height: 64 }} />;
                  const dateKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const items = byDate.get(dateKey) ?? [];
                  const isSelected = selectedDate === dateKey;
                  return (
                    <td
                      key={di}
                      onClick={() => {
                        setShowAddPicker(false);
                        setSelectedDate(isSelected ? null : dateKey);
                      }}
                      style={{
                        border: '1px solid #eee',
                        height: 64,
                        verticalAlign: 'top',
                        padding: 4,
                        cursor: 'pointer',
                        background: isSelected ? '#f0f6ff' : undefined,
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#888' }}>{day}</div>
                      {items.map((o) => (
                        <div
                          key={o.id}
                          style={{
                            fontSize: 11,
                            color: o.status === 'done' ? '#3182F6' : '#aaa',
                          }}
                        >
                          {o.chores.name}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedDate && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 12 }}>
            {formatSelectedDateLabel(selectedDate)}
          </p>
          {(byDate.get(selectedDate) ?? []).map((o) => {
            const isDone = o.status === 'done';
            return (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: '1px solid #f5f5f5',
                }}
              >
                <div style={{ width: 3, borderRadius: 2, background: isDone ? '#3182F6' : '#ddd' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Checkbox.Circle checked={isDone} onCheckedChange={() => handleToggle(o)} size={20} />
                    <span style={{ fontWeight: 'bold' }}>{o.chores.name}</span>
                  </div>
                  <Chip kind="action" size="small" variant="fill">
                    <ChipItem>
                      {isDone
                        ? o.completion_type === 'manual'
                          ? '수기 입력'
                          : '정기 수행'
                        : CHORE_TYPE_LABEL[o.chores.type]}
                    </ChipItem>
                  </Chip>
                </div>
              </div>
            );
          })}
          {(byDate.get(selectedDate) ?? []).length === 0 && (
            <p style={{ color: '#888', fontSize: 13 }}>이날 등록된 집안일이 없어요.</p>
          )}

          {showAddPicker ? (
            <div style={{ marginTop: 12, padding: 12, background: '#f8f9fa', borderRadius: 8 }}>
              {chores.filter((c) => c.is_active).length === 0 ? (
                <p style={{ fontSize: 13, color: '#888' }}>활성화된 집안일이 없어요.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {chores
                    .filter((c) => c.is_active)
                    .map((c) => (
                      <li key={c.id} style={{ padding: '8px 0' }}>
                        <button
                          type="button"
                          disabled={addingChoreId === c.id}
                          onClick={() => handleAddManual(c.id)}
                          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', width: '100%' }}
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <Button size="small" variant="weak" onClick={() => setShowAddPicker(false)} style={{ marginTop: 8 }}>
                취소
              </Button>
            </div>
          ) : (
            <Button size="small" variant="weak" onClick={() => setShowAddPicker(true)} style={{ marginTop: 8 }}>
              이날 한 집안일 추가
            </Button>
          )}

          <button type="button" onClick={() => setSelectedDate(null)} style={{ marginTop: 8, display: 'block' }}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
