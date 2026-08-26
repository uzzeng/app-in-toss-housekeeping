# 데이터베이스 스키마

> Supabase(PostgreSQL)에 실제로 생성된 테이블 스키마 정리 (2026-08-11 기준). 기획 단계의 필드 초안은 [`docs/PRD.md`의 데이터 모델 초안](PRD.md#데이터-모델-초안) 참고. 이 문서는 실제 DB에 반영된 타입/제약조건까지 담은 구현 기준 문서입니다.

> **2026-08-21 리전 마이그레이션**: 화면 전환 로딩 지연의 원인이 Supabase 프로젝트 리전이 도쿄(`ap-northeast-1`)로 설정되어 있던 것으로 확인되어, 서울(`ap-northeast-2`) 리전에 새 프로젝트(`housekeeping-seoul`, ref: `<seoul-project-ref>`)를 생성하고 전체 이전. 기존 도쿄 프로젝트(ref: `<tokyo-project-ref>`)는 롤백 대비로 당분간 보존, 이후 안정성 확인되면 정리 예정. 이전 절차: 스키마 재생성(RLS 정책 포함) → 데이터 이전(users 1건/chores 5건/chore_occurrences 14건, INSERT문 생성 방식으로 무손실 이전) → mTLS 인증서 secret 재등록 → Edge Function 5개 재배포 → Vault(project_url/send_reminders_api_key) 및 `pg_cron` 재설정 → 프론트엔드 `.env`의 `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` 교체 후 재빌드. 실기기 검증 완료(데이터 노출, CRUD, 설정, 알림 발송 모두 정상). 초기 체감 속도 저하는 새로 배포된 Edge Function들의 콜드 스타트였고, 몇 차례 호출 후 도쿄 리전과 비슷하거나 더 빠른 수준으로 안정화됨.

## 개요

- 백엔드: Supabase (PostgreSQL), 리전: Seoul (`ap-northeast-2`)
- 인증: 앱인토스 SDK 익명 식별키(`getAnonymousKey`) 기반. Supabase Auth(로그인 사용자) 미사용
- 접근 방식: 클라이언트는 Supabase에 직접 접근하지 않고, 항상 서버(Edge Function)를 거쳐 데이터에 접근. RLS는 `service_role`만 전체 접근 가능하도록 설정되어 있어, 클라이언트 키로는 어떤 테이블도 직접 조회/수정할 수 없음

## `users` — 사용자

익명 식별키 기반 사용자와 알림 설정을 저장.

| 컬럼 | 타입 | 제약조건 | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | `uuid` | PK | `gen_random_uuid()` | 사용자 식별자 |
| `anon_key` | `text` | UNIQUE, NOT NULL | — | 앱인토스 SDK `getAnonymousKey()`로 받은 익명 식별키(hash) |
| `notification_time` | `time` | NOT NULL | `'08:00'` | 알림 시간 |
| `notification_time_enabled` | `boolean` | NOT NULL | `false` | 알림 시간 사용 여부 (2026-08-20 추가, 기본값 false로 재조정) |
| `reminder_time` | `time` | NOT NULL | `'21:00'` | 리마인드 재알림 시간 |
| `reminder_time_enabled` | `boolean` | NOT NULL | `false` | 리마인드 재알림 사용 여부 |
| `reminder_days` | `integer` | NOT NULL | `0` | 재알림 일수 (2026-08-20 기본값 2 → 0으로 재조정) |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 생성 시각 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 수정 시각 |

## `chores` — 집안일 항목

사용자가 등록한 집안일 정의(반복 규칙 포함).

| 컬럼 | 타입 | 제약조건 | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | `uuid` | PK | `gen_random_uuid()` | 집안일 식별자 |
| `user_id` | `uuid` | NOT NULL, FK → `users.id` (`ON DELETE CASCADE`) | — | 소유 사용자 |
| `name` | `text` | NOT NULL | — | 집안일 이름 |
| `type` | `text` | NOT NULL, CHECK IN (`general`, `one_time`) | — | 유형: 일반 반복형 / 수시 등록형 (2026-08-26: `annual_fixed`는 코드에서 이미 제거된 지 오래였는데 DB 제약만 남아있던 걸 뒤늦게 정리) |
| `repeat_mode` | `text` | CHECK IN (`fixed_date`, `interval`) | — | 일반 반복형(`general`)일 때만 사용: 날짜 고정 / 주기 |
| `interval_value` | `integer` | — | — | `repeat_mode = interval`일 때 주기 값 (예: 3) |
| `interval_unit` | `text` | CHECK IN (`day`, `week`, `month`) | — | `repeat_mode = interval`일 때 주기 단위 (2026-08-26 `month` 추가) |
| `fixed_unit` | `text` | CHECK IN (`month`, `year`) | — | `repeat_mode = fixed_date`일 때 반복 단위 |
| `fixed_month` | `integer` | CHECK (1~12) | — | 고정 날짜의 월 (매년 반복일 때만 사용) |
| `fixed_day` | `integer` | CHECK (1~31) | — | 고정 날짜의 일 |
| `start_date` | `date` | NOT NULL | — | 최초 시작일 |
| `is_active` | `boolean` | NOT NULL | `true` | 활성/비활성 여부 (삭제 대신 비활성화) |
| `board_slot_index` | `integer` | — | — | 바둑돌 집 매핑 자리 (세부 설계 미확정, PRD 오픈 이슈 참고) |
| `sort_order` | `integer` | NOT NULL | `0` | 집안일 리스트 표시 순서 (2026-08-24 추가, 사용자가 드래그로 직접 지정). 기존 데이터는 사용자별 `created_at` 순으로 초기값 채움, 신규 등록 시 현재 최대값+1로 자동 계산 |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 생성 시각 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 수정 시각 |

**인덱스**: `chores_user_id_idx` (`user_id`)

**참고**: 사용자당 활성 집안일 최대 19개 제한(바둑돌 집 기획 반영)은 DB 제약이 아니라 애플리케이션 레벨에서 체크.

## `chore_occurrences` — 집안일 회차별 실행 기록

집안일 하나가 주기마다 생성하는 개별 실행 건. 완료/미완료, 캘린더 표시, 재알림 카운트가 모두 이 단위로 관리됨.

| 컬럼 | 타입 | 제약조건 | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | `uuid` | PK | `gen_random_uuid()` | 실행 건 식별자 |
| `chore_id` | `uuid` | NOT NULL, FK → `chores.id` (`ON DELETE CASCADE`) | — | 소속 집안일 |
| `scheduled_date` | `date` | NOT NULL | — | 예정일(최초알림일) |
| `status` | `text` | NOT NULL, CHECK IN (`pending`, `done`) | `'pending'` | 완료 상태 |
| `completed_date` | `date` | — | — | 완료 처리한 날짜 (완료 시에만 값 존재, 캘린더 표시 기준) |
| `completion_type` | `text` | CHECK IN (`regular`, `manual`) | — | 정기 수행 / 수기 입력 |
| `reminder_count` | `integer` | NOT NULL | `0` | 현재까지 발송된 재알림 차수 |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 생성 시각 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 수정 시각 |

**인덱스**: `chore_occurrences_chore_id_idx` (`chore_id`), `chore_occurrences_scheduled_date_idx` (`scheduled_date`)

## 관계

```
users (1) ── (N) chores (1) ── (N) chore_occurrences
```

- `users.id` ← `chores.user_id` (사용자 삭제 시 소유 집안일 전부 삭제)
- `chores.id` ← `chore_occurrences.chore_id` (집안일 삭제 시 실행 기록 전부 삭제)

## RLS (Row Level Security)

세 테이블 모두 RLS 활성화. 정책은 `service_role`만 전체 접근(`FOR ALL`) 허용하고, 그 외에는 접근 불가하도록 설정:

```sql
create policy "service_role full access on users"
  on public.users for all
  using (auth.role() = 'service_role');
```//`chores`, `chore_occurrences`도 동일 패턴

클라이언트(프론트엔드)는 Supabase에 직접 연결하지 않으므로, 실질적인 사용자별 데이터 분리는 서버(Edge Function)가 `anon_key`를 검증하고 그에 해당하는 `user_id`로 걸러서 조회/수정하는 로직으로 담당함.

## 미확정 사항

- 알림 발송 이력을 별도 로그 테이블로 관리할지 여부 (재발송 방지, 디버깅용) — 아직 테이블 없음
- `board_slot_index`(바둑돌 매핑) 관련 데이터 구조는 바둑돌 집 시각화 세부 설계가 정해진 뒤 확정
