/*
 * 화면 쪽 로그인 유지 규칙 (브라우저 시계 기준, 순수 계산만 — 테스트에서 그대로 확인).
 * 최종 판단은 항상 서버가 한다 (lib/server/auth.ts): 이 규칙은 화면을 제때 지우고 경고를 띄우기 위한 것.
 */

/** 실제 사용자 활동이 이만큼 없으면 자동 로그아웃 (서버와 같은 30분) */
export const IDLE_MS = 30 * 60_000;
/** 이만큼 활동이 없으면 "2분 후 자동 로그아웃" 경고 */
export const IDLE_WARN_MS = 28 * 60_000;
/** 활동 갱신 API 를 부르는 최소 간격 */
export const HEARTBEAT_MIN_MS = 60_000;
/** 최대 로그인 시간(8시간)이 이만큼 남으면 "다시 확인해 주세요" 안내 */
export const REAUTH_NOTICE_MS = 30 * 60_000;
/** 화면이 보이는 동안 서버 로그인 상태 확인 간격 (다른 기기의 "모든 기기 로그아웃" 반영) */
export const STATUS_POLL_MS = 5 * 60_000;

/**
 * 사용자 활동으로 인정하는 브라우저 이벤트 (isTrusted 인 것만 — 스크립트가 만든 가짜 이벤트는 제외).
 * 스크롤은 사용자가 직접 하는 동작(휠·터치 이동·키보드)으로 감지한다. scroll 이벤트 자체는 프로그램이
 * 스크롤을 옮겨도 생기므로 쓰지 않는다. 마우스를 움직이기만 하는 것(pointermove)도 활동으로 치지 않는다.
 */
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "touchmove"] as const;

export type Phase =
  | "active" // 정상
  | "reauth-soon" // 최대 시간 30분 전: 재확인 안내 (작업은 계속 가능)
  | "idle-warning" // 28분 미사용: 2분 후 자동 로그아웃 경고
  | "reauth-required" // 최대 시간 지남: 재확인 창 (화면은 가리고 입력 내용은 유지)
  | "idle-expired"; // 30분 미사용: 화면을 지우고 로그아웃

export interface PhaseInput {
  now: number;
  /** 마지막 실제 사용자 활동 (모든 탭 중 가장 최근) */
  lastActivity: number;
  /** 최대 로그인 시간이 끝나는 시각 (브라우저 시계로 바꾼 값). 모르면 null */
  absDeadline: number | null;
}

export function phaseAt({ now, lastActivity, absDeadline }: PhaseInput): Phase {
  const idle = now - lastActivity;
  if (idle >= IDLE_MS) return "idle-expired";
  if (absDeadline !== null && now >= absDeadline) return "reauth-required";
  if (idle >= IDLE_WARN_MS) return "idle-warning";
  if (absDeadline !== null && absDeadline - now <= REAUTH_NOTICE_MS) return "reauth-soon";
  return "active";
}

/** 자동 로그아웃까지 남은 밀리초 (경고 창의 카운트다운) */
export function idleRemainingMs(now: number, lastActivity: number): number {
  return Math.max(0, lastActivity + IDLE_MS - now);
}

/**
 * 활동 갱신 API 를 지금 부를지: 마지막 호출 뒤에 실제 활동이 있었고, 마지막 호출에서 1분이 지났을 때만.
 * (타이머가 돈다고 부르지 않는다 — 활동이 없으면 lastActivity 가 그대로라 false)
 */
export function shouldHeartbeat(now: number, lastActivity: number, lastSent: number): boolean {
  return lastActivity > lastSent && now - lastSent >= HEARTBEAT_MIN_MS;
}

/** 서버가 알려 준 시각(초)을 브라우저 시계(밀리초)로 바꾼다 (서버·PC 시계 차이 보정) */
export function toClientMs(serverSec: number, serverNowSec: number, clientNowMs: number): number {
  return clientNowMs + (serverSec - serverNowSec) * 1000;
}

/**
 * 서버의 미사용 만료를 보고 마지막 활동 시각을 맞춘다.
 * 다른 탭(같은 브라우저)에서 활동이 있었으면 서버 만료가 더 뒤에 있으므로 그만큼 앞당겨 반영한다.
 * 서버 값으로 활동을 "줄이지는" 않는다 (이 탭에서 방금 한 활동이 아직 서버에 안 갔을 수 있음).
 */
export function syncActivityFromServer(lastActivity: number, idleDeadlineClientMs: number): number {
  return Math.max(lastActivity, idleDeadlineClientMs - IDLE_MS);
}

/** 로그인 후 돌아갈 주소: 이 사이트 안의 경로만 (다른 사이트로 보내지 않음) */
export function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

/** 탭 사이 공유 (localStorage — 시각 숫자만 저장, 고객 정보·세션 값은 저장하지 않음) */
export const STORAGE_KEYS = {
  activity: "ws-auth-activity",
  heartbeat: "ws-auth-heartbeat",
  signout: "ws-auth-signout",
  renewed: "ws-auth-renewed",
} as const;
