export const SESSION_GAP_MS = 5 * 60 * 1000;
export const SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_POINT_LIMIT = 50000;

// Suy ra đợt đo từ dữ liệu; không khẳng định ESP32 đã khởi động lại.
// Đúng 5 phút vẫn là cùng đợt; chỉ tách khi khoảng cách lớn hơn 5 phút.
export function groupMeasurementSessions(observedTimes, gapMs = SESSION_GAP_MS) {
  if (!Number.isFinite(gapMs) || gapMs <= 0) throw new Error('Khoảng gián đoạn phải dương.');
  const times = [...new Set(observedTimes.map(t => new Date(t).getTime()).filter(Number.isFinite))].sort((a,b) => a-b);
  const sessions = [];
  for (const ts of times) {
    let session = sessions.at(-1);
    if (!session || ts - session.endTs > gapMs) {
      session = { id: String(ts), startTs: ts, endTs: ts, count: 0 };
      sessions.push(session);
    }
    session.endTs = ts;
    session.count++;
  }
  return sessions.map(s => ({...s, startedAt: new Date(s.startTs), endedAt: new Date(s.endTs)}));
}
