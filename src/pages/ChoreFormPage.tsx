import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BottomSheet, CTAButton, FixedBottomCTA, Post, SegmentedControl, TextField } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import { useCurrentUser } from '../hooks/useAnonymousKey';
import { toDisplayErrorMessage } from '../lib/errorMessage';
import { todayKst } from '../lib/date';
import {
  choresCache,
  createChore,
  fetchChores,
  updateChore,
  type Chore,
  type ChoreInput,
  type ChoreType,
  type FixedUnit,
  type IntervalUnit,
  type RepeatMode,
} from '../lib/chores';

interface FormState {
  name: string;
  type: ChoreType;
  repeatMode: RepeatMode;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  fixedUnit: FixedUnit;
  fixedMonth: string;
  fixedDay: string;
  startDate: string;
}

// 앱을 켠 시점에 한 번만 계산되면 날짜가 바뀐 뒤에도 옛 날짜가 시작일 기본값이 되므로, 폼을 열 때마다 만든다.
const makeInitialForm = (): FormState => ({
  name: '',
  type: 'general',
  repeatMode: 'interval',
  intervalValue: '1',
  intervalUnit: 'week',
  fixedUnit: 'month',
  fixedMonth: '1',
  fixedDay: '1',
  startDate: todayKst(),
});

function formFromChore(chore: Chore): FormState {
  return {
    name: chore.name,
    type: chore.type,
    repeatMode: chore.repeat_mode ?? 'interval',
    intervalValue: String(chore.interval_value ?? 1),
    intervalUnit: chore.interval_unit ?? 'week',
    fixedUnit: chore.fixed_unit ?? 'month',
    fixedMonth: String(chore.fixed_month ?? 1),
    fixedDay: String(chore.fixed_day ?? 1),
    startDate: chore.start_date,
  };
}

// TDS TextField는 자체 <input>을 완전히 제어해 type="number" 같은 네이티브 HTML 속성이
// 충돌해 입력 자체가 막히는 문제가 있었다. 숫자만 남기는 필터링으로 대체한다.
function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}월`, value: String(i + 1) }));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ name: `${i + 1}일`, value: String(i + 1) }));
const INTERVAL_UNIT_OPTIONS = [
  { name: '일마다', value: 'day' },
  { name: '주마다', value: 'week' },
  { name: '개월마다', value: 'month' },
];
const INTERVAL_UNIT_LABEL: Record<IntervalUnit, string> = { day: '일마다', week: '주마다', month: '개월마다' };

function buildChoreInput(form: FormState): ChoreInput {
  const base: ChoreInput = {
    name: form.name.trim(),
    type: form.type,
    start_date: form.startDate,
  };

  if (form.type === 'one_time') return base;

  if (form.repeatMode === 'interval') {
    return {
      ...base,
      repeat_mode: 'interval',
      interval_value: Number(form.intervalValue),
      interval_unit: form.intervalUnit,
    };
  }
  return {
    ...base,
    repeat_mode: 'fixed_date',
    fixed_unit: form.fixedUnit,
    fixed_month: form.fixedUnit === 'year' ? Number(form.fixedMonth) : undefined,
    fixed_day: Number(form.fixedDay),
  };
}

export function ChoreFormPage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { id: editingChoreId } = useParams<{ id: string }>();
  const isEditing = Boolean(editingChoreId);
  const anonKey = currentUser.status === 'success' ? currentUser.user.anonKey : null;
  // 직전 집안일 리스트 화면에서 choresCache가 이미 채워져 있는 경우가 많으므로, 있으면
  // 그 값으로 폼을 즉시 채우고 백그라운드로만 최신화한다 (수정 대상을 못 찾은 경우만 로딩 유지).
  const cachedChore =
    anonKey && editingChoreId ? choresCache.get(anonKey)?.find((c) => c.id === editingChoreId) ?? null : null;

  const [form, setForm] = useState<FormState>(() => (cachedChore ? formFromChore(cachedChore) : makeInitialForm()));
  const [loadingChore, setLoadingChore] = useState(isEditing && !cachedChore);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [monthSheetOpen, setMonthSheetOpen] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [intervalUnitSheetOpen, setIntervalUnitSheetOpen] = useState(false);

  function loadChore() {
    if (!anonKey || !editingChoreId) return;
    if (!choresCache.get(anonKey)?.some((c) => c.id === editingChoreId)) setLoadingChore(true);
    setErrorMessage(null);
    fetchChores(anonKey)
      .then((chores) => {
        const chore = chores.find((c) => c.id === editingChoreId);
        if (!chore) {
          setErrorMessage('해당 집안일을 찾을 수 없어요.');
          return;
        }
        setForm(formFromChore(chore));
      })
      .catch((error: unknown) => setErrorMessage(toDisplayErrorMessage(error)))
      .finally(() => setLoadingChore(false));
  }

  useEffect(loadChore, [anonKey, editingChoreId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!anonKey) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      if (editingChoreId) {
        await updateChore(anonKey, editingChoreId, buildChoreInput(form));
      } else {
        await createChore(anonKey, buildChoreInput(form));
      }
      navigate('/chores');
    } catch (error) {
      setErrorMessage(toDisplayErrorMessage(error));
      setSubmitting(false);
    }
  }

  if (loadingChore) {
    return <p style={{ padding: 16 }}>불러오는 중...</p>;
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
    <div style={{ padding: '12px 16px 96px' }}>
      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: adaptive.grey900 }}>
          {isEditing ? '집안일 수정' : '집안일 추가'}
        </p>
      </div>

      {errorMessage && (
        <p style={{ color: adaptive.red500, fontSize: 13, marginBottom: 12 }}>{errorMessage}</p>
      )}

      <form
        id="chore-form"
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div>
          <Post.Paragraph paddingBottom={8} typography="t6" fontWeight="medium" color={adaptive.grey900}>
            이름
          </Post.Paragraph>
          <TextField.Clearable
            variant="box"
            paddingTop={0}
            placeholder="집안일 이름 입력"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>

        <div>
          <Post.Paragraph paddingBottom={8} typography="t6" fontWeight="medium" color={adaptive.grey900}>
            유형
          </Post.Paragraph>
          <SegmentedControl
            value={form.type}
            onChange={(value) => setForm((f) => ({ ...f, type: value as ChoreType }))}
          >
            <SegmentedControl.Item value="general" style={{ fontSize: 13 }}>
              반복형
            </SegmentedControl.Item>
            <SegmentedControl.Item value="one_time" style={{ fontSize: 13 }}>
              1회성
            </SegmentedControl.Item>
          </SegmentedControl>
        </div>

        {form.type === 'general' && (
          <>
            <div>
              <Post.Paragraph paddingBottom={8} typography="t6" fontWeight="medium" color={adaptive.grey900}>
                반복 방식
              </Post.Paragraph>
              <SegmentedControl
                value={form.repeatMode}
                onChange={(value) => setForm((f) => ({ ...f, repeatMode: value as RepeatMode }))}
              >
                <SegmentedControl.Item value="interval" style={{ fontSize: 13 }}>
                  주기
                </SegmentedControl.Item>
                <SegmentedControl.Item value="fixed_date" style={{ fontSize: 13 }}>
                  날짜 고정
                </SegmentedControl.Item>
              </SegmentedControl>
              <div style={{ marginTop: 8 }}>
                <Post.Paragraph typography="st11" color={adaptive.grey500}>
                  {form.repeatMode === 'interval'
                    ? '* 완료한 날을 기준으로 다음 일정이 변경돼요'
                    : '* 완료 여부와 관계없이 정해진 날짜에 일정이 반복돼요'}
                </Post.Paragraph>
              </div>

              {form.repeatMode === 'interval' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 8,
                  }}
                >
                  <TextField.Clearable
                    variant="box"
                    placeholder="숫자 입력"
                    value={form.intervalValue}
                    onChange={(e) => setForm((f) => ({ ...f, intervalValue: onlyDigits(e.target.value) }))}
                    containerProps={{ style: { width: '100%', boxSizing: 'border-box' } }}
                  />
                  <TextField.Button
                    variant="box"
                    placeholder={INTERVAL_UNIT_LABEL[form.intervalUnit]}
                    onClick={() => setIntervalUnitSheetOpen(true)}
                  />
                </div>
              )}
            </div>

            {form.repeatMode === 'fixed_date' && (
              <div>
                <SegmentedControl
                  value={form.fixedUnit}
                  onChange={(value) => setForm((f) => ({ ...f, fixedUnit: value as FixedUnit }))}
                >
                  <SegmentedControl.Item value="month" style={{ fontSize: 14 }}>
                    매달
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="year" style={{ fontSize: 14 }}>
                    매년
                  </SegmentedControl.Item>
                </SegmentedControl>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: form.fixedUnit === 'year' ? '1fr 1fr' : '1fr',
                    gap: 4,
                    marginTop: 8,
                  }}
                >
                  {form.fixedUnit === 'year' && (
                    <TextField.Button
                      variant="box"
                      placeholder={`${form.fixedMonth}월`}
                      onClick={() => setMonthSheetOpen(true)}
                    />
                  )}
                  <TextField.Button
                    variant="box"
                    placeholder={`${form.fixedDay}일`}
                    onClick={() => setDaySheetOpen(true)}
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div>
          <Post.Paragraph paddingBottom={8} typography="t6" fontWeight="medium" color={adaptive.grey900}>
            최초 시작일
          </Post.Paragraph>
          <TextField.Clearable
            variant="box"
            paddingTop={0}
            type="date"
            placeholder="날짜 선택"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            required
          />
        </div>
      </form>

      <BottomSheet
        open={intervalUnitSheetOpen}
        onClose={() => setIntervalUnitSheetOpen(false)}
        header={<BottomSheet.Header>반복 단위 선택</BottomSheet.Header>}
        cta={
          <BottomSheet.CTA color="primary" variant="fill" onClick={() => setIntervalUnitSheetOpen(false)}>
            선택하기
          </BottomSheet.CTA>
        }
      >
        <BottomSheet.Select
          value={form.intervalUnit}
          options={INTERVAL_UNIT_OPTIONS}
          onChange={(e) => setForm((f) => ({ ...f, intervalUnit: e.target.value as IntervalUnit }))}
        />
      </BottomSheet>

      <BottomSheet
        open={monthSheetOpen}
        onClose={() => setMonthSheetOpen(false)}
        header={<BottomSheet.Header>월 선택</BottomSheet.Header>}
        cta={
          <BottomSheet.CTA color="primary" variant="fill" onClick={() => setMonthSheetOpen(false)}>
            선택하기
          </BottomSheet.CTA>
        }
      >
        <BottomSheet.Select
          value={form.fixedMonth}
          options={MONTH_OPTIONS}
          onChange={(e) => setForm((f) => ({ ...f, fixedMonth: e.target.value }))}
        />
      </BottomSheet>

      <BottomSheet
        open={daySheetOpen}
        onClose={() => setDaySheetOpen(false)}
        header={<BottomSheet.Header>일 선택</BottomSheet.Header>}
        cta={
          <BottomSheet.CTA color="primary" variant="fill" onClick={() => setDaySheetOpen(false)}>
            선택하기
          </BottomSheet.CTA>
        }
      >
        <BottomSheet.Select
          value={form.fixedDay}
          options={DAY_OPTIONS}
          onChange={(e) => setForm((f) => ({ ...f, fixedDay: e.target.value }))}
        />
      </BottomSheet>

      <FixedBottomCTA.Double
        leftButton={
          <CTAButton type="button" color="dark" variant="weak" display="block" onClick={() => navigate('/chores')}>
            취소
          </CTAButton>
        }
        rightButton={
          <CTAButton type="submit" form="chore-form" display="block" loading={submitting}>
            {isEditing ? '수정' : '추가'}
          </CTAButton>
        }
      />
    </div>
  );
}
