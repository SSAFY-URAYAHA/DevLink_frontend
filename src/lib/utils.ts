export async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('복사를 지원하지 않는 환경입니다. 내용을 선택해 직접 복사해주세요.')
  await navigator.clipboard.writeText(value)
}

export function formatDate(value: string | null): string {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '기록 없음'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
