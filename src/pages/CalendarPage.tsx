import { useEffect, useRef, useState } from 'react';
import { BottomSheet, Button, Chip, ChipItem, Checkbox, IconButton, useDialog } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import {
  addManualOccurrence,
  deleteManualOccurrence,
  fetchMonthOccurrences,
  setOccurrenceCompleted,
  type Occurrence,
} from '../lib/occurrences';
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

function formatShortDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${Number(m)}.${Number(d)}`;
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
  const { openAsyncConfirm } = useDialog();
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
  // "다른 날 완료" 날짜 피커: 대상 occurrence와 피커 자체의 월 커서(현재 캘린더 월과 독립)
  const [backdatingOccurrence, setBackdatingOccurrence] = useState<Occurrence | null>(null);
  const [pickerCursor, setPickerCursor] = useState({ year: 0, month: 0 });
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
      await addManualOccurrence(anonKey, pickedChoreId, selectedDate);
      setChorePickerOpen(false);
      setPickedChoreId(null);
      // 수기 입력은 서버에서 이후 예정(pending)을 삭제하고 새 기준일로 재계산하므로
      // 단순 append가 아니라 현재 월을 다시 조회해야 다음 예정 변경이 즉시 반영된다.
      const refreshed = await fetchMonthOccurrences(anonKey, toMonthParam(cursor.year, cursor.month));
      setOccurrences(refreshed);
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
      // 완료 여부가 바뀌면 "가장 최근 완료건" 기준의 다음 예정일 표시 대상도 함께 바뀌므로
      // 현재 월을 다시 조회해 정합성을 맞춘다.
      const refreshed = await fetchMonthOccurrences(anonKey, toMonthParam(cursor.year, cursor.month));
      setOccurrences(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setOccurrences((prev) =>
        prev.map((item) => (item.id === o.id ? { ...item, status: o.status, completed_date: o.completed_date } : item)),
      );
    }
  }

  function openBackdatePicker(o: Occurrence) {
    const base = o.scheduled_date < today ? o.scheduled_date : today;
    const [y, m] = base.split('-').map(Number);
    setPickerCursor({ year: y, month: m - 1 });
    setBackdatingOccurrence(o);
  }

  async function handleBackdate(dateKey: string) {
    if (!anonKey || !backdatingOccurrence) return;
    const o = backdatingOccurrence;
    setBackdatingOccurrence(null);
    setOccurrences((prev) =>
      prev.map((item) => (item.id === o.id ? { ...item, status: 'done', completed_date: dateKey } : item)),
    );
    try {
      await setOccurrenceCompleted(anonKey, o.id, true, dateKey);
      const refreshed = await fetchMonthOccurrences(anonKey, toMonthParam(cursor.year, cursor.month));
      setOccurrences(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setOccurrences((prev) =>
        prev.map((item) => (item.id === o.id ? { ...item, status: o.status, completed_date: o.completed_date } : item)),
      );
    }
  }

  async function handleDeleteManual(o: Occurrence) {
    if (!anonKey) return;
    const confirmed = await openAsyncConfirm({
      title: '수기 입력을 삭제할까요?',
      description: '삭제하면 되돌릴 수 없어요.',
      confirmButton: '삭제하기',
      cancelButton: '취소',
      onConfirmClick: async () => {
        await deleteManualOccurrence(anonKey, o.id);
      },
    });
    if (!confirmed) return;
    // 삭제 시 파생된 다음 예정(미완료) occurrence도 서버에서 함께 삭제/재생성되므로
    // 단순 필터가 아니라 현재 월을 다시 조회해 정합성을 맞춘다.
    try {
      const refreshed = await fetchMonthOccurrences(anonKey, toMonthParam(cursor.year, cursor.month));
      setOccurrences(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div style={{ padding: '12px 16px 16px' }}>
      <p style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>집안일 캘린더</p>

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
            const isManual = o.completion_type === 'manual';
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
                    <Checkbox.Circle
                      checked={isDone}
                      disabled={isManual}
                      onCheckedChange={() => {
                        if (isManual) return;
                        handleToggle(o);
                      }}
                      size={20}
                    />
                    <span style={{ fontWeight: 'bold' }}>{o.chores.name}</span>
                    {!isDone && (
                      <button
                        type="button"
                        onClick={() => openBackdatePicker(o)}
                        style={{
                          marginLeft: 'auto',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: 12,
                          color: adaptive.grey500,
                          textDecoration: 'underline',
                        }}
                      >
                        다른 날 완료
                      </button>
                    )}
                    {isManual && (
                      <button
                        type="button"
                        aria-label="수기 입력 삭제"
                        onClick={() => handleDeleteManual(o)}
                        style={{
                          marginLeft: 'auto',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: 16,
                          lineHeight: 1,
                          color: adaptive.grey400,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {o.next_scheduled_date && (
                    <p style={{ margin: '0 0 6px', paddingLeft: 28, fontSize: 12, color: adaptive.grey500 }}>
                      다음 예정일 {formatShortDate(o.next_scheduled_date)}
                    </p>
                  )}
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

          <BottomSheet
            open={backdatingOccurrence !== null}
            onClose={() => setBackdatingOccurrence(null)}
            header={<BottomSheet.Header>{backdatingOccurrence?.chores.name} · 실제로 한 날짜 선택</BottomSheet.Header>}
          >
            <div style={{ paddingLeft: 24, paddingBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingRight: 24 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 'bold', color: adaptive.grey900 }}>
                  {pickerCursor.year}년 {pickerCursor.month + 1}월
                </p>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton
                    aria-label="이전 달"
                    variant="clear"
                    name="icon-arrow-left-mono"
                    iconSize={20}
                    onClick={() =>
                      setPickerCursor((c) =>
                        c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 },
                      )
                    }
                  />
                  <IconButton
                    aria-label="다음 달"
                    variant="clear"
                    name="icon-arrow-right-mono"
                    iconSize={20}
                    disabled={pickerCursor.year === Number(today.slice(0, 4)) && pickerCursor.month === Number(today.slice(5, 7)) - 1}
                    onClick={() =>
                      setPickerCursor((c) =>
                        c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 },
                      )
                    }
                  />
                </div>
              </div>
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
                  {buildMonthGrid(pickerCursor.year, pickerCursor.month).map((week, wi) => (
                    <tr key={wi}>
                      {week.map((day, di) => {
                        if (day === null) return <td key={di} style={{ height: 44 }} />;
                        const dateKey = `${pickerCursor.year}-${String(pickerCursor.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isFuture = dateKey > today;
                        return (
                          <td
                            key={di}
                            onClick={() => !isFuture && handleBackdate(dateKey)}
                            style={{
                              height: 44,
                              textAlign: 'center',
                              cursor: isFuture ? 'default' : 'pointer',
                              padding: 0,
                            }}
                          >
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 32,
                                height: 32,
                                borderRadius: 10,
                                color: isFuture ? adaptive.grey300 : adaptive.grey900,
                              }}
                            >
                              <span style={{ fontSize: 14 }}>{day}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BottomSheet>
        </div>
      )}
    </div>
  );
}
