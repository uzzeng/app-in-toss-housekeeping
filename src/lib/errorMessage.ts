// fetch 함수들은 서버가 내려준 한글 에러(body.error)는 그대로 Error.message로 던지므로
// 그 경우는 이미 한글이라 통과시키고, 네트워크 자체가 실패한 경우(TypeError: Failed to fetch 등
// 브라우저/웹뷰가 만드는 영문 원문 메시지)만 공통 한글 안내로 바꾼다.
export function toDisplayErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return '네트워크 연결을 확인해 주세요.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '알 수 없는 오류가 발생했어요.';
}
