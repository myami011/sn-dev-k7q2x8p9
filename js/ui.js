/* ui.js — 화면 공통 함수 (이스케이프, 토스트, 모달, 날짜 표시) */
const UI = (() => {
  const $ = (id) => document.getElementById(id);

  // 외부에서 온 문자열은 반드시 esc() 를 거쳐 HTML 에 넣는다
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // 모달: 바깥 클릭/ESC 로 닫힘, 열려 있는 동안 배경 스크롤 고정(위치 기억)
  let scrollY = 0;
  function openModal(id) {
    scrollY = window.scrollY;
    $(id).classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    $(id).classList.remove('show');
    document.body.style.overflow = '';
    window.scrollTo(0, scrollY);
  }
  function bindModal(id) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id) closeModal(id); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $(id).classList.contains('show')) closeModal(id);
    });
  }

  // 마감일 표시: 지남=마감 / 0~3일=urgent(빨강) / 4~7일=soon(주황) / 그 외=later(회색). sub = 마감 월.일
  function deadlineInfo(deadline) {
    if (!deadline) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(deadline + 'T00:00:00');
    const days = Math.round((d - today) / 86400000);
    const sub = '~' + Number(deadline.slice(5, 7)) + '.' + Number(deadline.slice(8, 10));
    if (days < 0) return { text: '마감', sub, cls: 'over', expired: true, days };
    const text = days === 0 ? 'D-day' : 'D-' + days;
    return { text, sub, cls: days <= 3 ? 'urgent' : days <= 7 ? 'soon' : 'later', expired: false, days };
  }

  function debounce(fn, ms) {
    let t = null;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  return { $, esc, toast, openModal, closeModal, bindModal, deadlineInfo, debounce };
})();
