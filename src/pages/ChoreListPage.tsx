import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Checkbox, List, ListRow, useDialog } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { ErrorBanner } from '../components/ErrorBanner';
import { SortableChoreRow } from '../components/SortableChoreRow';
import { toDisplayErrorMessage } from '../lib/errorMessage';
import {
  CHORE_TYPE_LABEL,
  choresCache,
  deleteChore,
  fetchChores,
  reorderChores,
  updateChore,
  type Chore,
} from '../lib/chores';

function describeChore(chore: Chore): string {
  if (chore.type === 'one_time') return `${chore.start_date} (1회)`;
  if (chore.repeat_mode === 'fixed_date') {
    return chore.fixed_unit === 'year'
      ? `매년 ${chore.fixed_month}월 ${chore.fixed_day}일`
      : `매달 ${chore.fixed_day}일`;
  }
  const unitLabel = chore.interval_unit === 'week' ? '주' : '일';
  return `${chore.interval_value}${unitLabel}마다`;
}

export function ChoreListPage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { openAsyncConfirm } = useDialog();
  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;
  const [chores, setChores] = useState<Chore[]>(() => (anonKey ? choresCache.get(anonKey) ?? [] : []));
  const [loadingChores, setLoadingChores] = useState(() => !(anonKey && choresCache.has(anonKey)));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 정렬 모드: 드래그로 순서만 바꾸고, 확정(완료) 눌러야 서버에 반영된다.
  // 진입 시점의 순서를 보관해두었다가 취소하면 그대로 되돌린다.
  const [reordering, setReordering] = useState(false);
  const [reorderOriginal, setReorderOriginal] = useState<Chore[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function loadChores() {
    if (!anonKey) return;
    if (!choresCache.has(anonKey)) setLoadingChores(true);
    setErrorMessage(null);
    fetchChores(anonKey)
      .then(setChores)
      .catch((error: unknown) => setErrorMessage(toDisplayErrorMessage(error)))
      .finally(() => setLoadingChores(false));
  }

  useEffect(loadChores, [anonKey]);

  async function handleToggleActive(chore: Chore) {
    if (!anonKey) return;
    try {
      const updated = await updateChore(anonKey, chore.id, { is_active: !chore.is_active });
      setChores((prev) => {
        const next = prev.map((c) => (c.id === chore.id ? updated : c));
        choresCache.set(anonKey, next);
        return next;
      });
    } catch (error) {
      setErrorMessage(toDisplayErrorMessage(error));
    }
  }

  async function handleDelete(chore: Chore) {
    if (!anonKey) return;
    const confirmed = await openAsyncConfirm({
      title: '집안일을 삭제할까요?',
      description: '삭제하면 되돌릴 수 없어요.',
      confirmButton: '삭제하기',
      cancelButton: '취소',
      onConfirmClick: async () => {
        await deleteChore(anonKey, chore.id);
      },
    });
    if (!confirmed) return;
    setChores((prev) => {
      const next = prev.filter((c) => c.id !== chore.id);
      choresCache.set(anonKey, next);
      return next;
    });
  }

  function handleStartReorder() {
    setReorderOriginal(chores);
    setReordering(true);
  }

  function handleCancelReorder() {
    setChores(reorderOriginal);
    setReordering(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setChores((prev) => {
      const oldIndex = prev.findIndex((c) => c.id === active.id);
      const newIndex = prev.findIndex((c) => c.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function handleConfirmReorder() {
    if (!anonKey) return;
    setSavingOrder(true);
    try {
      await reorderChores(
        anonKey,
        chores.map((c) => c.id),
      );
      choresCache.set(anonKey, chores);
      setReordering(false);
    } catch (error) {
      setErrorMessage(toDisplayErrorMessage(error));
    } finally {
      setSavingOrder(false);
    }
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
    <div style={{ padding: '12px 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>집안일 리스트</p>
        {!loadingChores && !reordering && chores.length > 1 && (
          <Button size="small" variant="weak" color="dark" onClick={handleStartReorder}>
            순서 변경
          </Button>
        )}
        {reordering && (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="small" variant="weak" onClick={handleCancelReorder} disabled={savingOrder}>
              취소
            </Button>
            <Button size="small" onClick={handleConfirmReorder} loading={savingOrder}>
              완료
            </Button>
          </div>
        )}
      </div>

      {errorMessage && (
        <div style={{ padding: '0 16px' }}>
          <ErrorBanner message={errorMessage} onRetry={loadChores} />
        </div>
      )}

      {loadingChores ? (
        <p style={{ padding: '0 16px' }}>불러오는 중...</p>
      ) : reordering ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={chores.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <List>
              {chores.map((chore) => (
                <SortableChoreRow
                  key={chore.id}
                  chore={chore}
                  description={`${CHORE_TYPE_LABEL[chore.type]} ・ ${describeChore(chore)}`}
                />
              ))}
            </List>
          </SortableContext>
        </DndContext>
      ) : (
        <List>
          {chores.map((chore) => (
            <ListRow
              key={chore.id}
              onClick={() => navigate(`/chores/${chore.id}/history`)}
              left={
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox.Circle
                    size={24}
                    checked={chore.is_active}
                    onCheckedChange={() => handleToggleActive(chore)}
                  />
                </div>
              }
              contents={
                <ListRow.Texts
                  type="2RowTypeA"
                  top={chore.name}
                  topProps={{ color: adaptive.grey800, fontWeight: 'bold' }}
                  bottom={`${CHORE_TYPE_LABEL[chore.type]} ・ ${describeChore(chore)}`}
                  bottomProps={{ color: adaptive.grey600, typography: 'st12' }}
                />
              }
              right={
                <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="weak" onClick={() => navigate(`/chores/${chore.id}/edit`)}>
                    수정
                  </Button>
                  <Button size="small" variant="weak" color="danger" onClick={() => handleDelete(chore)}>
                    삭제
                  </Button>
                </div>
              }
              verticalPadding="large"
              horizontalPadding="small"
            />
          ))}
          <ListRow
            onClick={() => navigate('/chores/new')}
            left={<ListRow.AssetIcon shape="original" name="icon-plus-grey-fill" variant="fill" />}
            contents={
              <ListRow.Texts type="1RowTypeA" top="추가하기" topProps={{ color: adaptive.grey700 }} />
            }
            verticalPadding="large"
            horizontalPadding="small"
          />
        </List>
      )}
    </div>
  );
}
