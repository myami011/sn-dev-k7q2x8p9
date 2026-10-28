/* app.js — 사용자 앱 화면 로직
 *  공고 목록 전체(notices.json)를 한 번 받아서, 분류·지역·검색·정렬은 휴대폰에서 직접 처리한다.
 *  화면 4개 (하단 탭): 홈(요약·이번 주 마감·새 공고·분류) / 목록([접수 중]+[마감] 접힘) / 달력(마감일 기준) / 설정.
 *  지역 선택은 모든 화면 공통, 분류 탭·검색은 목록 화면 전용.
 *  휴대폰에 저장해 다음 실행 때 유지하는 값: 선택 동, 설정(시작 화면·화면 모드·글자 크기·정렬), 마지막으로 본 공고 번호(새 공고 N).
 */
(() => {
  const { $, esc, toast, openModal, closeModal, bindModal, deadlineInfo, debounce } = UI;
  const STORE_KEY = 'ln.dongs';
  const PREF_KEY = 'ln.prefs';      // 설정 (DEFAULT_PREFS 참고)
  const DEFAULT_PREFS = {
    start: 'home',     // 시작 화면: home | list | cal
    theme: 'system',   // 화면 모드: system(휴대폰 따름) | light | dark
    size: 'normal',    // 글자 크기: normal | large | xlarge
    sort: 'latest',    // 목록 정렬: latest | deadline
  };
  const SEEN_KEY = 'ln.seenMax';    // 지난번 실행 때 본 가장 큰 공고 id (DB 번호라 새 공고일수록 큼)
  const PHONE = /0\d{1,2}[-.)\s]?\d{3,4}[-.\s]?\d{4}/g;   // 02-2241-5148, 02)920-4711 …

  const state = {
    meta: { categories: [], dong_groups: [], ai_labels: {}, category_style: {} },
    all: [],
    dongs: loadJson(STORE_KEY, []),
    pickDongs: [],
    category: '',
    q: '',
    showClosed: false,
    view: 'home',
    calMonth: firstOfMonth(new Date()),   // 달력에 보이는 달 (1일)
    calSel: ymd(new Date()),              // 달력에서 고른 날
    prefs: Object.assign({}, DEFAULT_PREFS, loadJson(PREF_KEY, {})),
    seenMax: Number(loadJson(SEEN_KEY, 0)),
  };

  // ── 저장/복원 ─────────────────────────────────
  function loadJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
  }
  // 앱을 닫거나 다른 화면으로 갈 때 '여기까지 봤음' 저장 → 다음 실행 때 그 이후 공고에 N
  function rememberSeen() {
    const max = state.all.reduce((m, n) => Math.max(m, n.id), 0);
    if (max) saveJson(SEEN_KEY, max);
  }

  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const isNew = (n) => state.seenMax > 0 && n.id > state.seenMax;   // 첫 실행은 전부 새 공고라 표시 안 함
  const isClosed = (n) => { const d = deadlineInfo(n.deadline); return !!(d && d.expired); };
  const styleOf = (cat) => (state.meta.category_style || {})[cat] || { color: 'var(--fg-3)', icon: '📌' };
  const allDongs = () => state.meta.dong_groups.flatMap((g) => g.dongs);

  // ── 데이터 ────────────────────────────────────
  async function load() {
    try {
      const [meta, notices] = await Promise.all([Data.meta(), Data.notices()]);
      state.meta = meta;
      state.all = notices;
      const known = new Set(allDongs());
      state.dongs = state.dongs.filter((d) => known.has(d));     // 없어진 동 정리
      $('title').textContent = meta.title;
      document.title = meta.title;
      $('sample-bar').textContent = meta.sample || '';           // 샘플 데이터 안내문 (실데이터에는 없음)
      $('sample-bar').hidden = !meta.sample;
      renderRegion(); refresh();
    } catch (e) {
      $('list').innerHTML = '<div class="empty-msg">공고를 불러오지 못했습니다.<br>인터넷 연결을 확인하고 🔄 를 눌러 주세요.</div>';
    }
  }

  // 분류를 뺀 조건(지역·검색) — 탭 숫자에도 사용
  function baseFiltered() {
    const q = state.q, dongs = state.dongs;
    return state.all.filter((n) =>
      (!dongs.length || dongs.includes(n.dong)) &&
      (!q || n.title.includes(q) || (n.dong || '').includes(q) || (n.summary || '').includes(q)));
  }

  // 최신순: 등록일 내림차순 / 마감임박순: 마감 빠른 순 → 마감일 없음
  function sortList(list) {
    const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id;
    if (state.prefs.sort !== 'deadline') return list.sort(byDate);
    return list.sort((a, b) => (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1) ||
      (a.deadline || '').localeCompare(b.deadline || '') || byDate(a, b));
  }

  // ── 그리기 ────────────────────────────────────
  function refresh() { renderTabs(); renderList(); renderHome(); renderCal(); renderSettings(); }   // 수백 건이라 전부 다시 그려도 즉시

  // ── 화면 전환 ─────────────────────────────────
  function setView(v) {
    state.view = v;
    ['home', 'list', 'cal', 'set'].forEach((k) => { $('view-' + k).hidden = k !== v; });
    $('tabs').hidden = v !== 'list';
    $('btn-search').hidden = v !== 'list';
    if (v !== 'list' && !$('search-row').hidden) {      // 목록을 떠나면 검색 닫기
      $('search-row').hidden = true; $('btn-search').classList.remove('on');
      if (state.q) { state.q = ''; $('search').value = ''; refresh(); }
    }
    document.querySelectorAll('#bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    window.scrollTo(0, 0);
  }

  // 홈·통계에서 목록으로 이동 (정렬·분류 지정)
  function goList(opts) {
    if (opts.sort) setPref('sort', opts.sort);
    if (opts.category !== undefined) state.category = opts.category;
    refresh(); setView('list');
  }

  // ── 홈 ────────────────────────────────────────
  function renderHome() {
    const base = baseFiltered();
    const open = base.filter((n) => !isClosed(n));
    const days = (n) => { const d = deadlineInfo(n.deadline); return d ? d.days : Infinity; };
    const weekAgo = ymd(new Date(Date.now() - 7 * 86400000));
    const week = open.filter((n) => days(n) <= 7).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const fresh = open.filter((n) => (n.date || '') >= weekAgo).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stat = (cls, num, label, go) => '<button class="stat ' + cls + '" data-go="list" data-sort="' + go + '"><b>' + num + '</b><small>' + label + '</small></button>';
    $('home-stats').innerHTML =
      stat('urgent', open.filter((n) => days(n) === 0).length, '오늘 마감', 'deadline') +
      stat('soon', week.length, '이번 주 마감', 'deadline') +
      stat('accent', fresh.length, '최근 7일 등록', 'latest') +
      stat('', open.length, '접수 중', 'latest');
    $('home-week').innerHTML = week.length ? week.slice(0, 5).map(cardHtml).join('') : '<div class="empty-small">7일 안에 마감되는 공고가 없습니다.</div>';
    $('home-new').innerHTML = fresh.length ? fresh.slice(0, 5).map(cardHtml).join('') : '<div class="empty-small">최근 7일 동안 새로 올라온 공고가 없습니다.</div>';
    $('home-cats').innerHTML = state.meta.categories.map((c) => {
      const st = styleOf(c);
      return '<button class="cat-tile" data-go="list" data-category="' + esc(c) + '"><i>' + st.icon + '</i><span><b style="color:' + st.color + '">' +
        esc(c) + '</b><small>접수 중 ' + open.filter((n) => n.category === c).length + '건</small></span></button>';
    }).join('');
  }

  // ── 달력 (마감일 기준) ─────────────────────────
  function renderCal() {
    const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
    $('cal-title').textContent = y + '년 ' + (mo + 1) + '월';
    const byDay = {};
    baseFiltered().forEach((n) => { if (n.deadline) (byDay[n.deadline] = byDay[n.deadline] || []).push(n); });
    const today = ymd(new Date());
    let h = DOW.map((d, i) => '<div class="cal-dow' + (i === 0 ? ' sun' : '') + '">' + d + '</div>').join('');
    for (let i = 0; i < m.getDay(); i++) h += '<div class="cal-day out"></div>';
    const last = new Date(y, mo + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const key = ymd(new Date(y, mo, d));
      const list = byDay[key] || [];
      const exact = list.filter((n) => !n.deadline_est).length, est = list.length - exact;
      const cls = ['cal-day', new Date(y, mo, d).getDay() === 0 ? 'sun' : '', key < today ? 'past' : '',
                   key === today ? 'today' : '', key === state.calSel ? 'sel' : ''].join(' ');
      h += '<button class="' + cls + '" data-day="' + key + '"><span class="num">' + d + '</span><span class="marks">' +
        (exact ? '<i class="dot exact"></i>' + exact : '') + (est ? '<i class="dot est"></i>' + est : '') + '</span></button>';
    }
    $('cal-grid').innerHTML = h;

    const sel = new Date(state.calSel + 'T00:00:00');
    const items = (byDay[state.calSel] || []).sort((a, b) => a.deadline_est - b.deadline_est);
    $('cal-day-title').textContent = (sel.getMonth() + 1) + '월 ' + sel.getDate() + '일 (' + DOW[sel.getDay()] + ') 마감 ' + items.length + '건';
    $('cal-list').innerHTML = items.length ? items.map(cardHtml).join('') : '<div class="empty-small">이날 마감되는 공고가 없습니다.</div>';
  }

  function renderTabs() {
    const open = baseFiltered().filter((n) => !isClosed(n));     // 탭 숫자 = 접수 중 공고 수
    const count = (c) => (c ? open.filter((n) => n.category === c).length : open.length);
    $('tabs').innerHTML = [''].concat(state.meta.categories).map((c) =>
      '<button class="tab' + (c === state.category ? ' active' : '') + '" data-cat="' + esc(c) + '">' +
      esc(c || '전체') + '<span class="n">' + count(c) + '</span></button>').join('');
  }

  function renderRegion() {
    const n = state.dongs.length;
    $('btn-region').textContent = '📍 ' + (n === 0 ? '전체 지역' : n === 1 ? state.dongs[0] : state.dongs[0] + ' 외 ' + (n - 1) + '곳') + ' ▾';
  }

  function renderList() {
    const items = baseFiltered().filter((n) => !state.category || n.category === state.category);
    const open = sortList(items.filter((n) => !isClosed(n)));
    const closed = items.filter(isClosed).sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));

    const updated = state.meta.updated_at ? '업데이트 ' + state.meta.updated_at.slice(5) : '';
    $('meta').textContent = open.length + '건' + (updated ? ' · ' + updated : '') + (navigator.onLine ? '' : ' · 오프라인');
    $('sort').value = state.prefs.sort;
    $('list').innerHTML = open.length ? open.map(cardHtml).join('')
      : '<div class="empty-msg">' + (items.length ? '접수 중인 공고가 없습니다.<br>아래 마감된 공고를 확인하세요.' : '조건에 맞는 모집 공고가 없습니다.') + '</div>';

    $('closed-toggle').hidden = !closed.length;
    $('closed-toggle').innerHTML = '마감된 공고 ' + closed.length + '건<span>' + (state.showClosed ? '접기 ▲' : '펼치기 ▼') + '</span>';
    $('closed-list').hidden = !state.showClosed || !closed.length;
    $('closed-list').innerHTML = state.showClosed ? closed.map(cardHtml).join('') : '';
  }

  function cardHtml(n) {
    const dl = deadlineInfo(n.deadline);
    const st = styleOf(n.category);
    const badge = dl
      ? '<div class="dday ' + dl.cls + '"><b>' + dl.text + '</b><small>' + dl.sub + (n.deadline_est ? ' 추정' : '') + '</small></div>'
      : '<div class="dday none"><b>기간<br>확인</b></div>';
    return '<button class="card" data-id="' + n.id + '">' +
      '<div class="card-top"><span class="dong">' + esc(n.dong) + '</span>' +
        '<span class="cat" style="color:' + st.color + '">' + st.icon + ' ' + esc(n.subcategory || n.category || '') + '</span>' +
        (isNew(n) ? '<span class="new">N</span>' : '') + '</div>' +
      badge +
      '<div class="card-title">' + esc(n.title) + '</div>' +
      (n.summary ? '<div class="card-sum">' + esc(n.summary) + '</div>' : '') +
      '<div class="card-sub">' + esc(n.gu) + ' · 등록 ' + esc(n.date || '-') + '</div>' +
      '</button>';
  }

  // ── 지역 선택 ─────────────────────────────────
  function openDongPicker() {
    state.pickDongs = state.dongs.slice();
    renderDongPicker();
    openModal('dong-modal');
  }
  function renderDongPicker() {
    $('dong-groups').innerHTML = state.meta.dong_groups.map((g) =>
      '<div class="gu-title">' + esc(g.gu) + '</div><div class="dong-grid">' +
      g.dongs.map((d) => '<button class="dong-btn' + (state.pickDongs.includes(d) ? ' selected' : '') +
        '" data-dong="' + esc(d) + '">' + esc(d) + '</button>').join('') + '</div>').join('');
  }

  // ── 상세 ──────────────────────────────────────
  async function openDetail(id) {
    const n = state.all.find((x) => x.id === id);
    if (!n) return;
    const st = styleOf(n.category);
    $('d-title').textContent = n.title;
    $('d-sub').innerHTML = '<span class="dong">' + esc(n.dong) + '</span>' +
      '<span style="color:' + st.color + '">' + st.icon + ' ' + esc(n.subcategory || n.category || '') + '</span>' +
      '<span>' + esc(n.gu) + '</span>';
    $('d-link').href = n.url;
    $('d-body').innerHTML = '<div class="loading-msg">불러오는 중…</div>';
    openModal('detail-modal');
    try {
      $('d-body').innerHTML = detailHtml(await Data.detail(id), n);
    } catch (e) {
      $('d-body').innerHTML = '<div class="error-msg">내용을 불러올 수 없습니다. 원문 보기를 이용하세요.</div>';
    }
  }

  // 핵심 정보 하나로 통합: 기간 · 대상 · 접수 · 문의 · 담당 · 등록
  function detailHtml(d, n) {
    const ai = d.ai_summary || {};
    const f = d.fields || {};
    const dl = deadlineInfo(d.deadline);
    const period = ai.period
      ? esc(ai.period)
      : (d.deadline ? (esc(d.date || '') + ' ~ ' + esc(d.deadline)) : '원문에서 확인');
    const rows = [
      ['📅', '기간', period + (dl ? '<span class="dl ' + dl.cls + '">' + dl.text + '</span>' : '')],
      ai.target ? ['👥', '대상', esc(ai.target)] : null,
      ai.method ? ['📝', '접수', esc(ai.method)] : null,
      ai.contact ? ['☎', '문의', telify(ai.contact)] : null,
      ['🏢', '담당', esc(f['담당부서'] || n.dong)],
      ['🗓', '등록', esc(d.date || f['등록일'] || '-')],
    ].filter(Boolean);

    let h = ai.summary ? '<div class="lead"><small>AI 요약</small><p>' + esc(ai.summary) + '</p></div>' : '';
    h += '<div class="facts">' + rows.map(([i, k, v]) =>
      '<div class="fact"><i>' + i + '</i><span>' + k + '</span><div>' + v + '</div></div>').join('') + '</div>';

    if (d.error) {
      h += '<div class="error-msg">' + esc(d.error) + '</div>';
    } else if (state.meta.display_mode === 'raw' && d.full) {
      h += '<div class="section"><div class="section-head">원문</div><div class="raw-body">' + d.full + '</div></div>';
    } else if (d.content) {
      h += '<div class="section"><div class="section-head">📋 공고 내용' +
           '<button class="btn small" data-toggle="content">펼치기 ▼</button></div>' +
           '<div class="content-body" id="content-body" hidden>' + d.content + '</div></div>';
    }
    if (d.files && d.files.length) {
      h += '<div class="section"><div class="section-head">📎 첨부파일 ' + d.files.length + '</div>' +
        d.files.map((x) => '<a class="file-link" href="' + esc(x.url) + '" target="_blank" rel="noopener">📄 ' + esc(x.name) + '</a>').join('') +
        '</div>';
    }
    if (ai.summary) h += '<p class="note">AI 요약은 공고 원문을 자동으로 정리한 것입니다. 지원 전 원문을 꼭 확인하세요.</p>';
    return h;
  }

  // 전화번호를 눌러서 바로 걸 수 있게
  function telify(text) {
    return esc(text).replace(PHONE, (m) => '<a class="tel" href="tel:' + m.replace(/[^\d]/g, '') + '">' + m + '</a>');
  }

  // ── 설정 ──────────────────────────────────────
  function applyPrefs() {
    const root = document.documentElement;
    if (state.prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = state.prefs.theme;
    if (state.prefs.size === 'normal') delete root.dataset.size; else root.dataset.size = state.prefs.size;
    document.querySelectorAll('.seg[data-pref]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.prefs[seg.dataset.pref]));
    });
  }
  function setPref(key, value) {
    state.prefs[key] = value;
    saveJson(PREF_KEY, state.prefs);
    applyPrefs();
    if (key === 'sort') renderList();
  }
  function renderSettings() {
    $('set-region-val').textContent = $('btn-region').textContent.replace(/^📍 | ▾$/g, '') + ' ›';
    const open = state.all.filter((n) => !isClosed(n)).length;
    $('info-updated').textContent = state.meta.updated_at || '-';
    $('info-count').textContent = '접수 중 ' + open + '건 / 전체 ' + state.all.length + '건';
    $('info-gu').textContent = state.meta.dong_groups.map((g) => g.gu + ' ' + g.dongs.length + '개 동').join(', ') || '-';
    $('info-ver').textContent = state.meta.version || '-';
  }

  // ── 앱 설치 버튼 (안드로이드 크롬) ─────────────
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); installEvent = e; $('set-install-group').hidden = false;
  });

  // ── 이벤트 ────────────────────────────────────
  function bind() {
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      state.category = b.dataset.cat; refresh();
    });
    // 카드 누르기 (모든 화면 공통) · 홈의 바로가기 버튼
    document.querySelector('.app').addEventListener('click', (e) => {
      const c = e.target.closest('.card'); if (c) { openDetail(Number(c.dataset.id)); return; }
      const g = e.target.closest('[data-go="list"]'); if (!g) return;
      goList({ sort: g.dataset.sort, category: g.dataset.category });
    });
    document.querySelectorAll('#bottom-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('cal-prev').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); renderCal(); });
    $('cal-next').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); renderCal(); });
    $('cal-grid').addEventListener('click', (e) => { const d = e.target.closest('[data-day]'); if (d) { state.calSel = d.dataset.day; renderCal(); } });
    $('closed-toggle').addEventListener('click', () => { state.showClosed = !state.showClosed; renderList(); });

    $('btn-search').addEventListener('click', () => {
      const row = $('search-row'); row.hidden = !row.hidden;
      $('btn-search').classList.toggle('on', !row.hidden);
      if (!row.hidden) $('search').focus();
      else if (state.q) { state.q = ''; $('search').value = ''; refresh(); }
    });
    $('search').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); refresh(); }, 200));
    $('sort').addEventListener('change', (e) => setPref('sort', e.target.value));
    document.querySelectorAll('.seg[data-pref]').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (b) setPref(seg.dataset.pref, b.dataset.v);
    }));
    $('set-region').addEventListener('click', openDongPicker);
    $('btn-refresh').addEventListener('click', () => { load(); toast('최신 공고를 확인했습니다'); });
    $('btn-install').addEventListener('click', async () => {
      if (!installEvent) return;
      installEvent.prompt(); await installEvent.userChoice;
      installEvent = null; $('set-install-group').hidden = true;
    });
    window.addEventListener('online', renderList);
    window.addEventListener('offline', renderList);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rememberSeen(); });
    window.addEventListener('pagehide', rememberSeen);

    $('btn-region').addEventListener('click', openDongPicker);
    $('dong-groups').addEventListener('click', (e) => {
      const b = e.target.closest('.dong-btn'); if (!b) return;
      const d = b.dataset.dong;
      state.pickDongs = state.pickDongs.includes(d) ? state.pickDongs.filter((x) => x !== d) : state.pickDongs.concat(d);
      b.classList.toggle('selected');
    });
    $('dong-all').addEventListener('click', () => { state.pickDongs = allDongs(); renderDongPicker(); });
    $('dong-none').addEventListener('click', () => { state.pickDongs = []; renderDongPicker(); });
    $('dong-cancel').addEventListener('click', () => closeModal('dong-modal'));
    $('dong-apply').addEventListener('click', () => {
      // 전부 선택 = 전체와 같으므로 빈 배열로 저장 (새 동이 추가돼도 자동 포함)
      state.dongs = state.pickDongs.length === allDongs().length ? [] : state.pickDongs.slice();
      saveJson(STORE_KEY, state.dongs); renderRegion(); closeModal('dong-modal'); refresh();
    });

    $('d-close').addEventListener('click', () => closeModal('detail-modal'));
    $('d-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-toggle="content"]'); if (!b) return;
      const body = $('content-body');
      body.hidden = !body.hidden;
      b.textContent = body.hidden ? '펼치기 ▼' : '접기 ▲';
    });
    bindModal('dong-modal');
    bindModal('detail-modal');
  }

  // ── 시작 ──────────────────────────────────────
  applyPrefs();
  bind();
  setView(state.prefs.start);
  load();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* http·미리보기 등 미지원 환경 */ });
  }
})();
