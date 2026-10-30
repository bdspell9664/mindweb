import { useEffect, useRef } from 'react';
import type { Notice as NoticeShape } from '../store';

export default function Notice({
  notice,
  onClose,
}: {
  notice: NoticeShape | null;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 提示不常驻：成功类 5 秒、错误类 12 秒后自己退场。
  // 手机屏幕小，一直挂着会把图谱挡住一半。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => closeRef.current(),
      notice.kind === 'error' ? 12000 : 5000,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className={`notice is-${notice.kind}`} role="status">
      <div style={{ flex: 1 }}>
        <div>{notice.text}</div>
        {notice.detail && <div className="detail-text">{notice.detail}</div>}
      </div>
      <button type="button" className="notice-close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}
