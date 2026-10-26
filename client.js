// Capture and timing are independent of the host application's transport and data model.
export function createPitwall({ send, key = () => crypto.randomUUID(), enabled = true, namespace = 'pitwall', views = {} }) {
  if (typeof send!=='function') throw new TypeError('A send function is required.');
  let visitor, session;
  const timers = [];
  const current = () => timers.reduce((top, timer) => !top || timer.priority >= top.priority ? timer : top, null);
  function track(event, input = {}) {
    if (!enabled) return;
    try { visitor ||= localStorage.getItem(`${namespace}-visitor`); } catch { /* Tab-local fallback. */ }
    try { session ||= sessionStorage.getItem(`${namespace}-analytics-session`); } catch { /* Tab-local fallback. */ }
    visitor ||= key(); session ||= key();
    try { localStorage.setItem(`${namespace}-visitor`, visitor); } catch { /* Capture never blocks the product. */ }
    try { sessionStorage.setItem(`${namespace}-analytics-session`, session); } catch { /* Capture never blocks the product. */ }
    const ua = navigator.userAgent;
    const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const device = tablet ? 'tablet' : /iPhone|iPod|Android.*Mobile/i.test(ua) ? 'phone' : 'desktop';
    const os = /Android/i.test(ua) ? 'Android' : tablet || /iPhone|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Other';
    const browser = /Instagram|FBAN|FBAV/i.test(ua) ? 'Social in-app' : /; wv\)/i.test(ua) ? 'Android WebView' : /GSA\//i.test(ua) ? 'Google app' : /Edg/i.test(ua) ? 'Edge' : /Firefox|FxiOS/i.test(ua) ? 'Firefox' : /Chrome|CriOS/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Other';
    try {
      void Promise.resolve(send({id:key(),event,distinct_id:visitor,occurred_at:new Date().toISOString(),
        properties:{...input,session_id:session,device,os,browser,
          viewport:innerWidth<600 ? 'small' : innerWidth<1024 ? 'medium' : 'large'}})).catch(()=>{});
    } catch { /* Analytics must not break a user action. */ }
  }
  function time(step, context = {}, priority = 0) {
    if (!enabled || !step) return;
    current()?.flush();
    let since = performance.now(), closed = false;
    const reset = () => { since = performance.now(); };
    const flush = (leavingVisible = false) => {
      const now = performance.now(), duration = Math.round(now - since); since = now;
      if (!closed && current() === entry && (leavingVisible || document.visibilityState === 'visible') && duration > 0)
        track('step_time', { ...context, step, duration_ms: duration });
    };
    const entry = { priority, flush, reset };
    timers.push(entry);
    if (views[step]) track(views[step], context);
    const visibility = () => document.visibilityState === 'hidden' ? flush(true) : reset();
    const leaving = () => flush();
    const timer = setInterval(flush, 30000);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leaving);
    return () => {
      if (closed) return;
      const wasCurrent = current() === entry;
      flush(); closed = true; clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leaving);
      timers.splice(timers.indexOf(entry), 1); if (wasCurrent) current()?.reset();
    };
  }
  return { track, time };
}

