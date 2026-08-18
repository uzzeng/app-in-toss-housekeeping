import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, IconButton, TableRow, Text } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { fetchChoreHistory, type ChoreHistoryItem } from '../lib/occurrences';
import { fetchChores, type Chore } from '../lib/chores';

const THREE_MONTHS_DAYS = 90;

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

// 정수면 소수점 없이, 아니면 소수점 한 자리까지 표시 (예: 14 -> "14일", 7.5 -> "7.5일")
function formatCycleDays(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}일`;
}

function computeAverageCycle(history: ChoreHistoryItem[], today: string): number | null {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - THREE_MONTHS_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = history.filter((h) => h.completed_date >= cutoffStr);
  if (recent.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 0; i < recent.length - 1; i++) {
    gaps.push(daysBetween(recent[i + 1].completed_date, recent[i].completed_date));
  }
  return gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
}

export function ChoreHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [chore, setChore] = useState<Chore | null>(null);
  const [history, setHistory] = useState<ChoreHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;

  useEffect(() => {
    if (!anonKey || !id) return;
    Promise.all([fetchChores(anonKey), fetchChoreHistory(anonKey, id)])
      .then(([chores, historyData]) => {
        setChore(chores.find((c) => c.id === id) ?? null);
        setHistory(historyData);
      })
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [anonKey, id]);

  if (currentUser.status === 'error') {
    return (
      <div style={{ padding: 16 }}>
        <p>사용자 식별에 실패했어요: {currentUser.reason}</p>
        <p style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{currentUser.detail}</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const averageCycle = computeAverageCycle(history, today);

  return (
    <div style={{ padding: '12px 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', marginBottom: 12 }}>
        <IconButton
          aria-label="뒤로"
          variant="clear"
          name="icon-arrow-left-mono"
          iconSize={24}
          onClick={() => navigate(-1)}
        />
        <p style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>
          {chore?.name ?? '집안일 히스토리'}
        </p>
      </div>

      {errorMessage && <p style={{ padding: '0 16px', color: adaptive.red500, fontSize: 13 }}>{errorMessage}</p>}

      {loading ? (
        <p style={{ padding: '0 16px' }}>불러오는 중...</p>
      ) : (
        <div style={{ padding: '0 16px' }}>
          <div style={{ background: adaptive.blue50, borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
            <TableRow
              align="space-between"
              left={
                <Text color={adaptive.grey900} typography="t5" fontWeight="bold">
                  최근 3개월 평균 주기
                </Text>
              }
              right={
                <Text color={adaptive.blue500} typography="t5" fontWeight="bold">
                  {averageCycle === null ? '-' : formatCycleDays(averageCycle)}
                </Text>
              }
            />
          </div>

          {history.length === 0 ? (
            <p style={{ padding: '16px 0', color: adaptive.grey500, fontSize: 13 }}>완료 이력이 없어요.</p>
          ) : (
            history.map((item, i) => {
              const prev = history[i + 1];
              const gap = prev ? daysBetween(prev.completed_date, item.completed_date) : null;
              return (
                <TableRow
                  key={item.id}
                  align="space-between"
                  left={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text
                        color={adaptive.grey700}
                        typography="t5"
                        fontWeight="regular"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {item.completed_date}
                      </Text>
                      <Badge
                        size="small"
                        variant="weak"
                        color={item.completion_type === 'manual' ? 'elephant' : 'blue'}
                      >
                        {item.completion_type === 'manual' ? '수기' : '정기'}
                      </Badge>
                    </div>
                  }
                  right={
                    <Text color={adaptive.blue500} typography="t5" fontWeight="medium">
                      {gap === null ? '-' : `${gap}일`}
                    </Text>
                  }
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
