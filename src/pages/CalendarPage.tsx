import { useEffect, useRef, useState } from 'react';
import { BottomSheet, Button, Chip, ChipItem, Checkbox, IconButton } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { addManualOccurrence, fetchMonthOccurrences, setOccurrenceCompleted, type Occurrence } from '../lib/occurrences';
import { CHORE_TYPE_LABEL, fetchChores, type Chore } from '../lib/chores';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

type DotColor = 'blue' | 'red' | 'grey' | null;

function toMonthParam(year: number, month0to11: number): string {
  return `${year}-${String(month0to11 + 1).padStart(2, '0')}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function displayDateOf(o: Occurrence): string {
  // PRD 규칙: 완료 항목은 completed_date 칸, 미완료 항목은 scheduled_date 칸에 표시
  return o.status === 'done' && o.completed_date ? o.completed_date : o.scheduled_date;
}

// 그 날짜에 속한 항목들을 하나의 점 색으로 요약: 미완료가 남았으면 지난 날은 빨강, 오늘/미래는 회색. 모두 완료했으면 파랑.
function summarizeDotColor(items: Occurrence[], dateKey: string, today: string): DotColor {
  if (items.length === 0) return null;
  const hasPending = items.some((o) => o.status !== 'done');
  if (!hasPending) return 'blue';
  return dateKey < today ? 'red' : 'grey';
}

function dotColorHex(dot: DotColor): string {
  if (dot === 'blue') return adaptive.blue500;
  if (dot === 'red') return adaptive.red500;
  return adaptive.grey400;
}

function formatSelectedDateLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY[d.getDay()]}요일`;
}

// 상세 카드 왼쪽 색바: 완료는 파랑, 예정(미완료·미래)은 회색, 지난 날인데 미완료면 빨강.
function itemBarColor(o: Occurrence, today: string): string {
  if (o.status === 'done') return adaptive.blue500;
  return o.scheduled_date < today ? adaptive.red500 : adaptive.grey300;
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
  // 캘린더 진입 시에는 오늘 날짜가 기본으로 선택되어 있어야 한다.
  const [selectedDate, setSelectedDate] = useState<string | null>(() => todayKey());
  const [chores, setChores] = useState<Chore[]>([]);
  const [addingChoreId, setAddingChoreId] = useState<string | null>(null);
  const [pickedChoreId, setPickedChoreId] = useState<string | null>(null);
  const [chorePickerOpen, setChorePickerOpen] = useState(false);
  const isFirstLoad = useRef(true);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey) return;
    setLoading(true);
    // 최초 진입 시에는 오늘 날짜 선택을 유지하고, 이후 달 이동에서만 선택을 해제한다.
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
    } else {
      setSelectedDate(null);
    }
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
  const today = todayKey();
  const activeChores = chores.filter((c) => c.is_active);

  async function handleAddManual() {
    if (!anonKey || !selectedDate || !pickedChoreId) return;
    setAddingChoreId(pickedChoreId);
    try {
      const created = await addManualOccurrence(anonKey, pickedChoreId, selectedDate);
      setOccurrences((prev) => [...prev, created]);
      setChorePickerOpen(false);
      setPickedChoreId(null);
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
    <div style={{ padding: '12px 16px 16px' }}>
      <p style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>집안일 달력</p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 'bold', color: adaptive.grey900 }}>
          {cursor.year}년 {cursor.month + 1}월
        </p>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label="이전 달"
            variant="clear"
            name="icon-arrow-left-mono"
            iconSize={20}
            onClick={() =>
              setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))
            }
          />
          <IconButton
            aria-label="다음 달"
            variant="clear"
            name="icon-arrow-right-mono"
            iconSize={20}
            onClick={() =>
              setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))
            }
          />
        </div>
      </div>

      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {WEEKDAY.map((w) => (
                <th
                  key={w}
                  style={{ fontSize: 12, color: '#888', fontWeight: 'normal', padding: 0, textAlign: 'center' }}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  if (day === null) return <td key={di} style={{ height: 44 }} />;
                  const dateKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const items = byDate.get(dateKey) ?? [];
                  const isSelected = selectedDate === dateKey;
                  const isToday = dateKey === today;
                  const dot = summarizeDotColor(items, dateKey, today);
                  return (
                    <td
                      key={di}
                      onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                      style={{ height: 44, textAlign: 'center', cursor: 'pointer', padding: 0 }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          border: isToday ? `1px solid ${adaptive.grey400}` : '1px solid transparent',
                          background: isSelected ? adaptive.blue50 : undefined,
                        }}
                      >
                        <span style={{ fontSize: 14, color: adaptive.grey900 }}>{day}</span>
                        <span
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            marginTop: 1,
                            background: dot ? dotColorHex(dot) : 'transparent',
                          }}
                        />
                      </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <p style={{ fontWeight: 'bold', fontSize: 16, margin: 0 }}>{formatSelectedDateLabel(selectedDate)}</p>
            {selectedDate === today && (
              <span
                style={{
                  fontSize: 12,
                  color: adaptive.grey600,
                  background: adaptive.grey100,
                  borderRadius: 6,
                  padding: '2px 6px',
                }}
              >
                오늘
              </span>
            )}
          </div>
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
                <div style={{ width: 3, borderRadius: 2, background: itemBarColor(o, today) }} />
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

          <Button
            size="small"
            variant="weak"
            disabled={activeChores.length === 0}
            onClick={() => setChorePickerOpen(true)}
            style={{ marginTop: 8 }}
          >
            이날 한 집안일 추가
          </Button>

          <BottomSheet
            open={chorePickerOpen}
            onClose={() => {
              setChorePickerOpen(false);
              setPickedChoreId(null);
            }}
            header={<BottomSheet.Header>집안일 선택하기</BottomSheet.Header>}
            cta={
              <BottomSheet.DoubleCTA
                leftButton={
                  <Button
                    color="dark"
                    variant="weak"
                    onClick={() => {
                      setChorePickerOpen(false);
                      setPickedChoreId(null);
                    }}
                  >
                    취소
                  </Button>
                }
                rightButton={
                  <Button
                    disabled={!pickedChoreId}
                    loading={addingChoreId !== null}
                    onClick={handleAddManual}
                  >
                    추가하기
                  </Button>
                }
              />
            }
          >
            <BottomSheet.Select
              value={pickedChoreId ?? undefined}
              options={activeChores.map((c) => ({ name: c.name, value: c.id, hideUnCheckedCheckBox: true }))}
              onChange={(e) => setPickedChoreId(e.target.value)}
            />
          </BottomSheet>
        </div>
      )}
    </div>
  );
}
