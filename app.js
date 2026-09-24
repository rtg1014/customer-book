/* 고객 수첩 — 보험 가입자 · 소속 가족 · 차량 정보를 폰 안에만 저장하는 앱
 *
 * 데이터 구조 (고객 1명 = 보험 가입자 1명)
 *   customer { id, name, phone, memo, createdAt, updatedAt,
 *              family:   [{ id, relation, name, phone }],            ← 가입자 앞으로 든 가족
 *              vehicles: [{ id, ownerId, plate, model, expiry, memo }] }
 *   vehicle.ownerId === 'self' 이면 가입자 본인 차, 아니면 family[].id 의 차.
 *   보험료는 항상 가입자가 냅니다.
 */
(() => {
  'use strict';

  const APP_VERSION = '1.2.2';
  const DEFAULT_ACCIDENT = { name: '현대해상', phone: '1588-5656' };
  const RELATIONS = ['배우자', '자녀', '부모', '형제자매', '기타'];
  const FONT_SIZES = [17, 20, 23];
  const FONT_LABELS = ['보통', '크게', '아주 크게'];
  const EXPIRY_WINDOW = 30; // 만기 임박 기준(일)
  const BACKUP_REMIND_DAYS = 30;
  const RELOCK_MS = 60 * 1000;

  // ---------- 작은 도우미 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const digits = (s) => String(s ?? '').replace(/\D/g, '');
  const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const ICON = {
    copy:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    search:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    gear:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    back:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    plus:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    car:
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 8l2 5v4H4v-4Z"/><circle cx="7.5" cy="14" r=".6" fill="currentColor"/><circle cx="16.5" cy="14" r=".6" fill="currentColor"/></svg>',
  };

  // ---------- 저장소 (IndexedDB: 폰 안에만 저장) ----------
  const DB = {
    db: null,
    open() {
      return new Promise((resolve, reject) => {
        const r = indexedDB.open('customer-book', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('customers')) d.createObjectStore('customers', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        };
        r.onsuccess = () => {
          this.db = r.result;
          resolve();
        };
        r.onerror = () => reject(r.error);
      });
    },
    tx(store, mode, fn) {
      return new Promise((resolve, reject) => {
        const t = this.db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('저장이 취소되었습니다'));
      });
    },
    all: (store) => DB.tx(store, 'readonly', (s) => s.getAll()),
    put: (store, v) => DB.tx(store, 'readwrite', (s) => s.put(v)),
    del: (store, k) => DB.tx(store, 'readwrite', (s) => s.delete(k)),
    replaceAll: (list) =>
      DB.tx('customers', 'readwrite', (s) => {
        s.clear();
        list.forEach((c) => s.put(c));
      }),
    async getMeta(k, def) {
      const r = await DB.tx('meta', 'readonly', (s) => s.get(k));
      return r ? r.value : def;
    },
    setMeta: (k, v) => DB.put('meta', { key: k, value: v }),
  };

  const Prefs = {
    get(k, d) {
      try {
        const v = localStorage.getItem('cb.' + k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('cb.' + k, JSON.stringify(v));
      } catch {}
    },
  };

  // 카카오톡·네이버·인스타 등 다른 앱 안에서 열린 브라우저인지
  const UA = navigator.userAgent || '';
  const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(UA);
  const IS_KAKAO = /KAKAOTALK/i.test(UA);
  const IS_STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function openInChrome() {
    const url = location.href;
    if (IS_KAKAO) location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    else if (/Android/i.test(UA)) location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    else copyText(url);
  }

  // ---------- 상태 ----------
  const S = {
    customers: [],
    accident: { ...DEFAULT_ACCIDENT },
    lastBackup: null,
    pinHash: null,
    q: '',
    view: Prefs.get('view', 'card'),
    sortKey: Prefs.get('sortKey', 'name'),
    sortDir: Prefs.get('sortDir', 1),
    onlyExpiring: false,
    font: Prefs.get('font', 1),
    matches: new Map(),
    persisted: false,
  };

  // ---------- 형식 ----------
  function fmtPhone(s) {
    let d = digits(s);
    if (!d) return str(s);
    if (d.length === 10 && d.startsWith('10')) d = '0' + d; // 엑셀에서 앞자리 0이 빠진 경우
    if (d.startsWith('02')) {
      if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
      if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    if (d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    if (d.length === 8 && /^1[5-9]/.test(d)) return d.replace(/(\d{4})(\d{4})/, '$1-$2');
    return str(s);
  }
  // 입력하는 동안 자동으로 하이픈(-) 넣기
  function fmtPhoneLive(v) {
    const d = digits(v).slice(0, 11);
    if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
    if (d.startsWith('02')) {
      if (d.length <= 2) return d;
      if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
      if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
      return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
    }
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length === 10 && !d.startsWith('01')) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  function applyLivePhone(el) {
    const caret = el.selectionStart ?? el.value.length;
    const before = digits(el.value.slice(0, caret)).length;
    const f = fmtPhoneLive(el.value);
    if (f === el.value) return;
    el.value = f;
    let pos = 0;
    let n = 0;
    while (pos < f.length && n < before) {
      if (/\d/.test(f[pos])) n++;
      pos++;
    }
    try {
      el.setSelectionRange(pos, pos);
    } catch {}
  }

  function today0() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const isoDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function daysUntil(s) {
    const d = parseDate(s);
    return d ? Math.round((d - today0()) / 86400000) : null;
  }
  function fmtDate(s) {
    const d = parseDate(s);
    return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : '';
  }
  function fmtTs(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }
  // 여러 형식의 날짜를 YYYY-MM-DD로
  function normDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : isoDate(v);
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
      const n = Number(v);
      if (n > 20000 && n < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    }
    const s = String(v).trim();
    let m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(s);
    if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!m) {
      const y2 = /^(\d{2})\D+(\d{1,2})\D+(\d{1,2})\D*$/.exec(s);
      if (y2) m = [0, '20' + y2[1], y2[2], y2[3]];
    }
    if (!m) return '';
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // 만기: 날짜 + 남은 날 (예: 만기 2026.9.26 · D-2)
  function expiryBadge(s) {
    const n = daysUntil(s);
    if (n === null) return '';
    const date = esc(fmtDate(s));
    if (n < 0) return `<span class="badge bad">만기 ${date} · 지남</span>`;
    if (n <= EXPIRY_WINDOW) return `<span class="badge warn">만기 ${date} · ${n === 0 ? '오늘' : 'D-' + n}</span>`;
    return `<span class="badge">만기 ${date}</span>`;
  }
  function expiryBadgeShort(s) {
    const n = daysUntil(s);
    if (n === null || n > EXPIRY_WINDOW) return '';
    return n < 0 ? '<span class="badge bad">지남</span>' : `<span class="badge warn">${n === 0 ? '오늘' : 'D-' + n}</span>`;
  }
  const isExpiring = (c) =>
    c.vehicles.some((v) => {
      const n = daysUntil(v.expiry);
      return n !== null && n >= -EXPIRY_WINDOW && n <= EXPIRY_WINDOW;
    });

  // ---------- 복사 ----------
  async function copyText(text) {
    text = str(text);
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {}
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {}
      ta.remove();
    }
    if (ok && navigator.vibrate) navigator.vibrate(30);
    toast(ok ? `"${text}" 복사되었습니다` : '복사하지 못했습니다. 길게 눌러 직접 복사해 주세요');
  }
  const copyChip = (value, cls = '') =>
    value ? `<button type="button" class="copy ${cls}" data-act="copy" data-v="${esc(value)}"><span>${esc(value)}</span>${ICON.copy}</button>` : '';

  // ---------- 검색 (초성, 숫자, 차번호 뒷자리) ----------
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function toCho(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      o += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
    }
    return o;
  }
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-.()·,]/g, '');
  const isChoOnly = (s) => /^[ㄱ-ㅎ]+$/.test(s);

  function matchCustomer(c, q) {
    if (!q) return { type: null };
    const cho = isChoOnly(q);
    const hit = (t) => {
      const n = norm(t);
      return n && (n.includes(q) || (cho && toCho(n).includes(q)));
    };
    if ([c.name, c.phone, c.memo].some(hit)) return { type: null };
    for (const f of c.family) {
      if ([f.name, f.phone, f.relation].some(hit)) return { type: 'fam', id: f.id, label: `${f.relation} ${f.name}`.trim() };
    }
    for (const v of c.vehicles) {
      if ([v.plate, v.model, v.memo].some(hit)) {
        const o = ownerOf(c, v);
        return { type: 'veh', id: v.id, ownerId: v.ownerId, label: `${o ? `${o.relation} ${o.name}의` : '본인'} 차량 ${v.plate || v.model}`.trim() };
      }
    }
    return null;
  }

  // ---------- 고객 도우미 ----------
  function ownerOf(c, v) {
    if (!v.ownerId || v.ownerId === 'self') return null;
    return c.family.find((f) => f.id === v.ownerId) || null;
  }
  const ownerShort = (c, v) => {
    const f = ownerOf(c, v);
    return f ? `${f.relation} ${f.name}`.trim() : '본인';
  };
  const vehiclesOf = (c, ownerId) => c.vehicles.filter((v) => (v.ownerId || 'self') === ownerId);

  function normalizeCustomer(c) {
    const family = (Array.isArray(c.family) ? c.family : []).map((f) => ({
      id: str(f.id) || uid(),
      relation: str(f.relation) || '기타',
      name: str(f.name),
      phone: fmtPhone(f.phone),
    }));
    const famIds = new Set(family.map((f) => f.id));
    const vehicles = (Array.isArray(c.vehicles) ? c.vehicles : []).map((v) => ({
      id: str(v.id) || uid(),
      ownerId: famIds.has(v.ownerId) ? v.ownerId : 'self',
      plate: str(v.plate),
      model: str(v.model),
      expiry: normDate(v.expiry),
      memo: str(v.memo),
    }));
    const now = Date.now();
    return {
      id: str(c.id) || uid(),
      name: str(c.name),
      phone: fmtPhone(c.phone),
      memo: str(c.memo),
      family,
      vehicles,
      createdAt: Number(c.createdAt) || now,
      updatedAt: Number(c.updatedAt) || now,
    };
  }

  // ---------- 정렬 ----------
  const COLS = [
    { k: 'name', label: '가입자', get: (c) => c.name },
    { k: 'owner', label: '운전자', veh: true, get: (c, v, f) => (f ? `${f.relation} ${f.name}` : v ? ownerShort(c, v) : '') },
    { k: 'plate', label: '차번호', veh: true, get: (c, v) => v && v.plate },
    { k: 'model', label: '차종', veh: true, get: (c, v) => v && v.model },
    { k: 'expiry', label: '만기일', veh: true, get: (c, v) => v && v.expiry },
    { k: 'ownerPhone', label: '운전자 휴대폰', veh: true, get: (c, v, f) => digits(f ? f.phone : v ? (ownerOf(c, v) || c).phone : '') },
    { k: 'phone', label: '가입자 휴대폰', get: (c) => digits(c.phone) },
    { k: 'memo', label: '메모', get: (c, v) => (v && v.memo) || '' },
    { k: 'createdAt', label: '등록일', get: (c) => c.createdAt },
    { k: 'updatedAt', label: '수정일', get: (c) => c.updatedAt },
  ];
  const COL = Object.fromEntries(COLS.map((c) => [c.k, c]));
  const CARD_SORTS = ['name', 'plate', 'model', 'expiry', 'createdAt', 'updatedAt'];
  const TABLE_COLS = ['who', 'plate', 'model', 'expiry', 'ownerPhone', 'memo'];
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const isEmpty = (v) => v === null || v === undefined || v === '';
  function cmp(a, b, dir) {
    const ea = isEmpty(a), eb = isEmpty(b);
    if (ea && eb) return 0;
    if (ea) return 1; // 빈 값은 항상 맨 뒤
    if (eb) return -1;
    const r = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
    return r * dir;
  }
  function customerSortValue(c, col) {
    if (!col.veh) return col.get(c, null);
    const vals = c.vehicles.map((v) => col.get(c, v)).filter((x) => !isEmpty(x));
    vals.sort((a, b) => collator.compare(String(a), String(b)));
    return vals[0] ?? '';
  }

  // ---------- 화면: 목록 ----------
  function renderShell() {
    applyFont();
    $('#app').innerHTML = `
      <header class="topbar">
        <h1>고객 수첩</h1><div class="grow"></div>
        <div class="font-ctl" role="group" aria-label="글씨 크기">
          ${[0, 1, 2].map((i) => `<button type="button" data-act="font" data-v="${i}" aria-label="글씨 ${FONT_LABELS[i]}">가</button>`).join('')}
        </div>
        <button type="button" class="btn-top" data-act="settings" aria-label="설정">${ICON.gear}</button>
      </header>
      <div class="searchbar">
        <div class="search-box">
          ${ICON.search}
          <input id="q" type="search" placeholder="이름·전화·차번호 검색" autocomplete="off" enterkeyhint="search" aria-label="검색">
          <button type="button" class="clear hidden" data-act="clear-q" aria-label="검색어 지우기">✕</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="보기 방식">
          <button type="button" data-act="view" data-v="card">카드</button>
          <button type="button" data-act="view" data-v="table">표</button>
        </div>
        <select class="select" id="sort" aria-label="정렬 기준"></select>
        <button type="button" class="btn-ghost" data-act="sortdir" id="sortdir"></button>
      </div>
      <div class="subbar">
        <span class="count" id="count"></span>
        <button type="button" class="chip" data-act="expiring" id="expiring">만기 임박만</button>
      </div>
      ${
        IN_APP && !IS_STANDALONE
          ? `<div class="banner inapp"><span><b>카카오톡 안에서 열려 있어요.</b> 여기에 적은 고객 정보는 크롬이나 설치한 앱에서 보이지 않고, 백업·설치도 잘 안 됩니다. 크롬으로 열어서 쓰세요.</span><button type="button" data-act="open-chrome">크롬으로 열기</button></div>`
          : ''
      }
      <div id="banner"></div>
      <main id="results"></main>
      <button type="button" class="add-fab" data-act="new">${ICON.plus} 새 가입자 등록</button>
    `;
    $('#q').value = S.q;
    renderControls();
    renderResults();
  }

  function applyFont() {
    document.documentElement.style.fontSize = FONT_SIZES[S.font] + 'px';
    document.documentElement.className = 'f' + S.font;
    $$('[data-act="font"]').forEach((b) => b.classList.toggle('on', +b.dataset.v === S.font));
  }

  function renderControls() {
    applyFont();
    $$('[data-act="view"]').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
    const keys = CARD_SORTS;
    if (!keys.includes(S.sortKey)) S.sortKey = 'name';
    $('#sort').innerHTML = keys
      .map((k) => `<option value="${k}" ${k === S.sortKey ? 'selected' : ''}>${k === 'name' ? '이름' : COL[k].label} 순</option>`)
      .join('');
    $('#sortdir').textContent = S.sortDir === 1 ? '▲ 오름' : '▼ 내림';
    $('#sortdir').setAttribute('aria-label', S.sortDir === 1 ? '오름차순' : '내림차순');
    $('#expiring').classList.toggle('on', S.onlyExpiring);
    $('.clear').classList.toggle('hidden', !S.q);
  }

  function filtered() {
    const q = norm(S.q);
    S.matches = new Map();
    const list = [];
    for (const c of S.customers) {
      const m = matchCustomer(c, q);
      if (!m) continue;
      if (S.onlyExpiring && !isExpiring(c)) continue;
      S.matches.set(c.id, m);
      list.push(c);
    }
    return list;
  }

  function renderBanner() {
    const el = $('#banner');
    if (!el) return;
    const n = S.customers.length;
    const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 86400000) : null;
    if (n > 0 && (days === null || days >= BACKUP_REMIND_DAYS)) {
      el.innerHTML = `<div class="banner"><span>${days === null ? '아직 백업을 안 했어요.' : `마지막 백업이 ${days}일 전이에요.`} 폰이 바뀌면 정보가 사라질 수 있어요.</span><button type="button" data-act="backup">지금 백업</button></div>`;
    } else el.innerHTML = '';
  }

  function renderResults() {
    const el = $('#results');
    if (!el) return;
    if (S.q || S.onlyExpiring) $('#banner').innerHTML = '';
    else renderBanner();
    const list = filtered();
    const searching = !!S.q || S.onlyExpiring;
    $('#count').textContent = searching ? `찾은 가입자 ${list.length}명` : `전체 가입자 ${list.length}명`;

    if (!S.customers.length) {
      el.innerHTML = `<div class="empty"><b>아직 등록된 고객이 없습니다</b>아래 <b style="display:inline;color:var(--pri)">＋ 새 가입자 등록</b> 버튼을 눌러 시작하세요.<br><br>엑셀에 정리해 둔 명단이 있으면<br>오른쪽 위 설정(톱니바퀴)에서 불러올 수 있습니다.</div>`;
      return;
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty"><b>찾는 고객이 없습니다</b>${S.onlyExpiring ? '만기 임박 고객이 없거나, ' : ''}검색어를 다시 확인해 주세요.<br>이름 초성(예: ㄱㅅㅎ), 전화번호 뒷자리, 차번호 뒷자리로도 찾을 수 있습니다.</div>`;
      return;
    }
    const col = COL[S.sortKey] || COL.name;
    if (S.view === 'table') renderTable(el, list, col);
    else renderCards(el, list, col);
  }

  const carRow = (v) =>
    `<div class="c-car"><span class="plate">${esc(v.plate || '번호없음')}</span>${v.model ? `<span class="model">${esc(v.model)}</span>` : ''}${expiryBadge(v.expiry)}</div>`;

  // 카드: 가입자 → (본인 차량) → 소속 가족(가지 모양) → 가족의 차량
  function renderCards(el, list, col) {
    const sorted = list
      .map((c) => ({ c, v: customerSortValue(c, col) }))
      .sort((a, b) => cmp(a.v, b.v, S.sortDir) || collator.compare(a.c.name, b.c.name))
      .map((x) => x.c);
    el.innerHTML = sorted
      .map((c) => {
        const m = S.matches.get(c.id);
        const selfVs = vehiclesOf(c, 'self');
        let body = '';
        if (selfVs.length) body += `<div class="c-person self"><div class="c-who">본인 차량</div>${selfVs.map(carRow).join('')}</div>`;
        if (c.family.length) {
          body += `<div class="c-fam"><div class="c-fam-title">${esc(c.name)} 님 소속 가족 ${c.family.length}명</div>${c.family
            .map((f) => {
              const vs = vehiclesOf(c, f.id);
              const hl = m && ((m.type === 'fam' && m.id === f.id) || (m.type === 'veh' && m.ownerId === f.id)) ? ' hl' : '';
              return `<div class="c-person c-kin${hl}"><div class="c-who"><span class="rel">${esc(f.relation)}</span>${esc(f.name)}</div>${
                vs.length ? vs.map(carRow).join('') : '<div class="c-car muted">차량 없음</div>'
              }</div>`;
            })
            .join('')}</div>`;
        }
        const summary = [c.family.length ? `가족 ${c.family.length}명` : '', c.vehicles.length ? `차량 ${c.vehicles.length}대` : ''].filter(Boolean).join(' · ');
        return `
        <article class="card" data-act="open" data-id="${c.id}">
          <div class="card-main">
            <div class="c-name">${esc(c.name)} <span class="role">가입자</span></div>
            ${c.phone ? `<div class="c-phone">${esc(c.phone)}</div>` : ''}
            ${summary ? `<div class="c-summary">${summary}</div>` : ''}
          </div>
          ${c.phone ? `<button type="button" class="copy-btn" data-act="copy" data-v="${esc(c.phone)}" aria-label="${esc(c.name)} 번호 복사">${ICON.copy}번호<br>복사</button>` : ''}
          ${body ? `<div class="c-body">${body}</div>` : ''}
          ${m && m.type ? `<div class="c-match">↳ ${esc(m.label)} 일치</div>` : ''}
        </article>`;
      })
      .join('');
  }

  // 한 가입자의 줄들: 본인 차량 → 가족(차량별 한 줄, 차 없으면 한 줄)
  function tableRows(c) {
    const rows = [];
    vehiclesOf(c, 'self').forEach((v) => rows.push({ v, f: null }));
    for (const f of c.family) {
      const vs = vehiclesOf(c, f.id);
      if (vs.length) vs.forEach((v) => rows.push({ v, f }));
      else rows.push({ v: null, f });
    }
    return rows;
  }

  // 표: 가입자별로 묶음 줄을 두고, 그 아래에 소속된 사람·차량을 가지 모양으로
  function renderTable(el, list, col) {
    const groups = list
      .map((c) => ({ c, v: customerSortValue(c, col) }))
      .sort((a, b) => cmp(a.v, b.v, S.sortDir) || collator.compare(a.c.name, b.c.name))
      .map((x) => x.c);
    const ncol = TABLE_COLS.length;
    const body = groups
      .map((c) => {
        const rows = tableRows(c);
        const summary = [c.family.length ? `가족 ${c.family.length}명` : '', `차량 ${c.vehicles.length}대`].filter(Boolean).join(' · ');
        const head = `<tr class="grp" data-act="open" data-id="${c.id}"><td colspan="${ncol}"><div class="grp-in"><b>${esc(c.name)}</b><span class="role">가입자</span>${
          c.phone ? `<span class="grp-phone">${esc(c.phone)}</span>` : ''
        }<span class="grp-sum">${summary}</span></div></td></tr>`;
        if (!rows.length) {
          return head + `<tr class="child" data-act="open" data-id="${c.id}"><td class="sticky"><span class="tree">└</span><span class="who-t">본인</span></td><td colspan="${ncol - 1}" class="muted">차량 없음</td></tr>`;
        }
        let lastF;
        const kids = rows
          .map(({ v, f }, i) => {
            const last = i === rows.length - 1;
            const sameAsPrev = i > 0 && lastF === (f ? f.id : 'self');
            lastF = f ? f.id : 'self';
            const who = sameAsPrev ? '<span class="muted small">〃</span>' : f ? `<span class="rel">${esc(f.relation)}</span><span class="who-t">${esc(f.name)}</span>` : '<span class="who-t">본인</span>';
            const phone = sameAsPrev ? '' : esc(f ? f.phone : c.phone);
            const cells = [
              `<td class="sticky"><span class="tree">${last ? '└' : '├'}</span>${who}</td>`,
              `<td class="pl">${v ? esc(v.plate) : '<span class="muted">차량 없음</span>'}</td>`,
              `<td>${v ? esc(v.model) : ''}</td>`,
              `<td>${v && v.expiry ? `${esc(fmtDate(v.expiry))} ${expiryBadgeShort(v.expiry)}` : ''}</td>`,
              `<td>${phone}</td>`,
              `<td class="memo">${v ? esc(v.memo) : ''}</td>`,
            ].join('');
            return `<tr class="child" data-act="open" data-id="${c.id}" data-vid="${v ? v.id : ''}">${cells}</tr>`;
          })
          .join('');
        return head + kids;
      })
      .join('');
    const headCells = TABLE_COLS.map((k) => {
      const sk = k === 'who' ? 'name' : k;
      const label = { who: '이름', plate: '차번호', model: '차종', expiry: '만기일', ownerPhone: '휴대폰', memo: '차량 메모' }[k];
      const sortable = ['name', 'plate', 'model', 'expiry'].includes(sk);
      const on = sortable && sk === S.sortKey;
      const arrow = on ? (S.sortDir === 1 ? ' ▲' : ' ▼') : '';
      const inner = sortable ? `<button type="button" data-act="sort-col" data-k="${sk}">${label}${arrow}</button>` : `<span class="th-plain">${label}</span>`;
      return `<th class="${k === 'who' ? 'sticky' : ''}${on ? ' on' : ''}">${inner}</th>`;
    }).join('');
    el.innerHTML = `
      <div class="table-wrap"><table class="grid tree-grid"><thead><tr>${headCells}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="table-hint">파란 줄이 가입자이고, 그 아래 ├ └ 줄이 그 가입자에 소속된 본인·가족의 차량입니다. 옆으로 밀면 나머지 칸이 보입니다.</p>`;
  }

  // ---------- 화면 쌓기 (안드로이드 뒤로가기 지원) ----------
  const stack = [];
  let allowLeave = false;

  function pushScreen(item) {
    const el = document.createElement('div');
    el.className = 'screen';
    el.style.zIndex = 20 + stack.length;
    item.el = el;
    stack.push(item);
    item.render();
    document.body.appendChild(el);
    el.scrollTop = 0;
    history.pushState({ depth: stack.length }, '');
    if (item.afterOpen) item.afterOpen();
  }
  function closeTop() {
    const item = stack.pop();
    if (item) item.el.remove();
  }
  const goBack = () => history.back();

  window.addEventListener('popstate', () => {
    if (openModal) {
      history.pushState({ depth: stack.length }, '');
      openModal.close(null);
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    if (top.type === 'edit' && !allowLeave && isDraftDirty()) {
      history.pushState({ depth: stack.length }, '');
      confirmBox({
        title: '저장하지 않고 나갈까요?',
        body: '입력한 내용이 저장되지 않습니다.',
        buttons: [
          { label: '계속 입력하기', value: false, kind: 'pri' },
          { label: '저장 안 하고 나가기', value: true, kind: 'danger' },
        ],
      }).then((ok) => {
        if (ok) {
          allowLeave = true;
          history.back();
        }
      });
      return;
    }
    allowLeave = false;
    closeTop();
    if (top.onClose) top.onClose();
  });

  function refreshAll() {
    renderResults();
    for (const it of stack) if (it.type !== 'edit') it.render();
  }

  // ---------- 화면: 가입자 상세 ----------
  function vehCard(v, hl) {
    return `
      <div class="veh ${hl ? 'hl' : ''}">
        <div class="veh-top">${copyChip(v.plate, 'plate-copy') || '<span class="plate">차번호 없음</span>'}</div>
        <dl class="kv">
          <dt>차종</dt><dd>${v.model ? copyChip(v.model, 'plain') : '-'}</dd>
          <dt>만기일</dt><dd>${v.expiry ? expiryBadge(v.expiry) : '-'}</dd>
          ${v.memo ? `<dt>메모</dt><dd class="memo-text">${esc(v.memo)}</dd>` : ''}
        </dl>
      </div>`;
  }

  function openDetail(id, focusVid) {
    const item = {
      type: 'detail',
      id,
      render() {
        const c = S.customers.find((x) => x.id === id);
        if (!c) {
          this.el.innerHTML = `<header class="topbar"><button type="button" class="btn-top" data-act="back">${ICON.back} 목록</button></header><div class="screen-body"><div class="empty"><b>삭제된 고객입니다</b></div></div>`;
          return;
        }
        const m = S.matches.get(id) || {};
        const hlVid = focusVid || (m.type === 'veh' ? m.id : null);
        const hlFid = m.type === 'fam' ? m.id : m.type === 'veh' && m.ownerId !== 'self' ? m.ownerId : null;
        const selfVs = vehiclesOf(c, 'self');
        const family = c.family
          .map((f) => {
            const vs = vehiclesOf(c, f.id);
            return `
            <section class="panel person ${f.id === hlFid ? 'hl' : ''}">
              <div class="person-head">
                <span class="rel">${esc(f.relation)}</span><span class="person-name">${esc(f.name) || '이름 없음'}</span>
              </div>
              ${f.phone ? `<div class="person-phone">${copyChip(f.phone)}</div>` : '<div class="muted small">휴대폰 번호 없음</div>'}
              <div class="veh-list">${vs.map((v) => vehCard(v, v.id === hlVid)).join('') || '<div class="muted small">등록된 차량 없음</div>'}</div>
            </section>`;
          })
          .join('');
        const acc = S.accident;
        this.el.innerHTML = `
          <header class="topbar">
            <button type="button" class="btn-top" data-act="back">${ICON.back} 목록</button>
            <div class="grow"></div>
            <button type="button" class="btn-top solid" data-act="edit" data-id="${c.id}">수정</button>
          </header>
          <div class="screen-body">
            <section class="panel person main">
              <div class="role-line"><span class="role">가입자</span> 보험료를 내는 분</div>
              <div class="hero-name">${esc(c.name)}</div>
              ${c.phone ? `<div class="person-phone">${copyChip(c.phone, 'big')}</div>` : '<div class="muted">휴대폰 번호 없음</div>'}
              <h4 class="sub-title">${ICON.car} 본인 차량 ${selfVs.length}대</h4>
              <div class="veh-list">${selfVs.map((v) => vehCard(v, v.id === hlVid)).join('') || '<div class="muted small">등록된 차량 없음</div>'}</div>
              ${c.memo ? `<h4 class="sub-title">메모</h4><div class="memo-text">${esc(c.memo)}</div>` : ''}
            </section>

            <h3 class="sec-title">소속 가족 <span class="n">${c.family.length}명</span></h3>
            <p class="help sec-help">${esc(c.name)} 님 앞으로 보험을 든 가족입니다.</p>
            <div class="family-tree">${family || '<div class="panel muted">등록된 가족이 없습니다.</div>'}</div>

            ${
              acc.phone
                ? `<section class="panel accident-box">
                    <div><b>${esc(acc.name)} 사고접수</b><div class="muted small">눌러서 번호 복사</div></div>
                    ${copyChip(acc.phone, 'big')}
                  </section>`
                : ''
            }

            <div class="btn-row">
              <button type="button" class="btn pri big" data-act="edit" data-id="${c.id}">수정하기</button>
              <button type="button" class="btn danger big" data-act="delete" data-id="${c.id}">삭제</button>
            </div>
            <p class="muted small" style="text-align:center;margin-top:1rem">등록 ${fmtTs(c.createdAt)} · 마지막 수정 ${fmtTs(c.updatedAt)}</p>
          </div>`;
      },
    };
    pushScreen(item);
  }

  // ---------- 화면: 등록/수정 ----------
  let draft = null;
  let draftOrig = '';
  const isDraftDirty = () => draft && JSON.stringify(draft) !== draftOrig;
  const newVehicle = (ownerId) => ({ id: uid(), ownerId, plate: '', model: '', expiry: '', memo: '' });

  function openEdit(id) {
    const src = id ? S.customers.find((c) => c.id === id) : null;
    draft = src ? clone(src) : { id: uid(), name: '', phone: '', memo: '', family: [], vehicles: [], createdAt: 0, updatedAt: 0, _new: true };
    draftOrig = JSON.stringify(draft);
    const item = {
      type: 'edit',
      render() {
        const selfVs = vehiclesOf(draft, 'self');
        this.el.innerHTML = `
          <header class="topbar">
            <button type="button" class="btn-top" data-act="back">취소</button>
            <h2 class="grow" style="text-align:center">${draft._new ? '새 가입자 등록' : '가입자 정보 수정'}</h2>
            <button type="button" class="btn-top solid" data-act="save">저장</button>
          </header>
          <div class="screen-body">
            <section class="panel person main">
              <div class="role-line"><span class="role">가입자</span> 보험료를 내는 분</div>
              <label class="field"><span>이름<em>필수</em></span>
                <input class="input" data-f="name" value="${esc(draft.name)}" autocomplete="off" enterkeyhint="next"></label>
              <label class="field"><span>휴대폰</span>
                <input class="input" data-f="phone" data-phone type="tel" inputmode="numeric" value="${esc(draft.phone)}" placeholder="숫자만 누르세요" autocomplete="off"></label>
              <label class="field"><span>메모</span>
                <textarea class="input" data-f="memo" rows="2" placeholder="자유롭게 적어 두세요">${esc(draft.memo)}</textarea></label>
              <h4 class="sub-title">${ICON.car} 본인 차량 ${selfVs.length}대</h4>
              <div class="veh-list">${selfVs.map((v, i) => vehBlock(v, i)).join('')}</div>
              <button type="button" class="btn add-line" data-act="add-veh" data-owner="self">${ICON.plus} 본인 차량 추가</button>
            </section>

            <h3 class="sec-title">소속 가족 <span class="n">${draft.family.length}명</span></h3>
            <p class="help sec-help">이 가입자 앞으로 보험을 든 가족(배우자, 자녀 등)과 그 가족의 차량을 적어 두세요.</p>
            <div class="family-tree">${draft.family.map(famBlock).join('')}</div>
            <button type="button" class="btn add-line" data-act="add-fam">${ICON.plus} 가족 추가</button>
            <div style="height:1.2rem"></div>
            <button type="button" class="btn pri big block" data-act="save">저장하기</button>
          </div>`;
      },
      afterOpen() {
        if (draft._new)
          setTimeout(() => {
            const a = document.activeElement;
            if (!a || a === document.body) $('[data-f="name"]', this.el)?.focus();
          }, 250);
      },
      onClose() {
        draft = null;
      },
    };
    pushScreen(item);
  }

  function famBlock(f, i) {
    const vs = vehiclesOf(draft, f.id);
    return `
    <section class="panel person" data-fid="${f.id}">
      <div class="sub-head"><b>가족 ${i + 1}</b><button type="button" class="btn danger small" data-act="rm-fam" data-fid="${f.id}">이 가족 빼기</button></div>
      <div class="two">
        <label class="field"><span>관계</span>
          <select class="input" data-fam="relation">${RELATIONS.map((r) => `<option ${r === f.relation ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="field"><span>이름</span><input class="input" data-fam="name" value="${esc(f.name)}" autocomplete="off"></label>
      </div>
      <label class="field"><span>휴대폰</span><input class="input" data-fam="phone" data-phone type="tel" inputmode="numeric" value="${esc(f.phone)}" placeholder="숫자만 누르세요" autocomplete="off"></label>
      <h4 class="sub-title">${ICON.car} <span><span data-fam-label>${esc(f.name || '이 가족')}</span>의 차량 ${vs.length}대</span></h4>
      <div class="veh-list">${vs.map((v, j) => vehBlock(v, j)).join('')}</div>
      <button type="button" class="btn add-line" data-act="add-veh" data-owner="${f.id}">${ICON.plus} 이 가족의 차량 추가</button>
    </section>`;
  }

  function vehBlock(v, i) {
    return `
    <div class="veh edit" data-vid="${v.id}">
      <div class="sub-head"><b>차량 ${i + 1}</b><button type="button" class="btn danger small" data-act="rm-veh" data-vid="${v.id}">이 차량 빼기</button></div>
      <div class="two">
        <label class="field"><span>차번호</span><input class="input" data-veh="plate" value="${esc(v.plate)}" placeholder="12가3456" autocomplete="off"></label>
        <label class="field"><span>차종</span><input class="input" data-veh="model" value="${esc(v.model)}" placeholder="쏘렌토" autocomplete="off"></label>
      </div>
      <label class="field"><span>보험 만기일</span><input class="input" data-veh="expiry" type="date" value="${esc(v.expiry)}"></label>
      <label class="field"><span>차량 메모</span><input class="input" data-veh="memo" value="${esc(v.memo)}" autocomplete="off"></label>
    </div>`;
  }

  const editTop = () => stack[stack.length - 1];

  async function saveDraft() {
    const d = draft;
    d.name = str(d.name);
    if (!d.name) {
      toast('가입자 이름을 입력해 주세요');
      const inp = $('[data-f="name"]', editTop().el);
      inp.focus();
      inp.scrollIntoView({ block: 'center' });
      return;
    }
    const hasVehContent = (v) => str(v.plate) || str(v.model) || v.expiry || str(v.memo);
    // 이름·번호·차량이 모두 빈 가족은 버림
    d.family = d.family.filter((f) => str(f.name) || digits(f.phone) || d.vehicles.some((v) => v.ownerId === f.id && hasVehContent(v)));
    const famIds = new Set(d.family.map((f) => f.id));
    d.vehicles = d.vehicles.filter((v) => hasVehContent(v) && (v.ownerId === 'self' || famIds.has(v.ownerId)));
    const isNew = !!d._new;
    delete d._new;
    const now = Date.now();
    if (isNew) d.createdAt = now;
    d.updatedAt = now;
    const rec = normalizeCustomer(d);
    try {
      await DB.put('customers', rec);
    } catch (e) {
      d._new = isNew;
      toast('저장에 실패했습니다: ' + (e && e.message ? e.message : e));
      return;
    }
    const idx = S.customers.findIndex((c) => c.id === rec.id);
    if (idx >= 0) S.customers[idx] = rec;
    else S.customers.push(rec);
    requestPersist();
    allowLeave = true;
    goBack();
    setTimeout(() => {
      refreshAll();
      toast(isNew ? `${rec.name} 님을 등록했습니다` : '저장했습니다');
    }, 60);
  }

  async function deleteCustomer(id) {
    const c = S.customers.find((x) => x.id === id);
    if (!c) return;
    const ok = await confirmBox({
      title: `${c.name} 님을 삭제할까요?`,
      body: `소속 가족 ${c.family.length}명, 차량 ${c.vehicles.length}대 정보도 함께 지워집니다.`,
      buttons: [
        { label: '삭제하기', value: true, kind: 'danger solid' },
        { label: '취소', value: false },
      ],
    });
    if (!ok) return;
    await DB.del('customers', id);
    S.customers = S.customers.filter((x) => x.id !== id);
    goBack();
    setTimeout(() => {
      refreshAll();
      toast(`${c.name} 님을 삭제했습니다`, {
        action: '되돌리기',
        onAction: async () => {
          await DB.put('customers', c);
          S.customers.push(c);
          refreshAll();
          toast('되돌렸습니다');
        },
      });
    }, 60);
  }

  // ---------- 화면: 설정 ----------
  function openSettings() {
    const item = {
      type: 'settings',
      render() {
        const vehCount = S.customers.reduce((s, c) => s + c.vehicles.length, 0);
        const famCount = S.customers.reduce((s, c) => s + c.family.length, 0);
        this.el.innerHTML = `
          <header class="topbar">
            <button type="button" class="btn-top" data-act="back">${ICON.back} 목록</button>
            <h2 class="grow" style="text-align:center">설정</h2>
            <div style="width:46px"></div>
          </header>
          <div class="screen-body">
            <h3 class="sec-title">글씨 크기</h3>
            <div class="panel">
              <div class="font-big">
                ${FONT_LABELS.map((l, i) => `<button type="button" data-act="font" data-v="${i}" class="${i === S.font ? 'on' : ''}" style="font-size:${FONT_SIZES[i] * 0.9}px">${l}</button>`).join('')}
              </div>
            </div>

            <h3 class="sec-title">저장된 정보</h3>
            <div class="panel">
              <div class="stat"><span>가입자 ${S.customers.length}명</span><span>가족 ${famCount}명</span><span>차량 ${vehCount}대</span></div>
              <p class="help">모든 정보는 이 폰 안에만 저장되고 인터넷으로 보내지지 않습니다.${S.persisted ? '' : '<br>폰 저장 공간이 부족하면 지워질 수 있으니 백업을 꼭 해 두세요.'}</p>
            </div>

            <h3 class="sec-title">백업 (엑셀 파일)</h3>
            <div class="panel">
              <p class="help" style="margin-top:0">마지막 백업: <b>${S.lastBackup ? fmtTs(S.lastBackup) : '없음'}</b><br>백업 파일을 카톡 '나와의 채팅' 등에 보내 두면 폰을 바꿔도 되살릴 수 있습니다. 엑셀에서 열어 볼 수도 있어요.</p>
              <div class="btn-row">
                <button type="button" class="btn pri" data-act="backup-share">카톡 등으로 보내기</button>
                <button type="button" class="btn" data-act="backup">폰에 파일로 저장</button>
              </div>
              <div class="btn-row">
                <button type="button" class="btn" data-act="import">백업·엑셀 파일 불러오기</button>
              </div>
              <div class="btn-row">
                <button type="button" class="btn small" data-act="template">빈 엑셀 입력 양식 받기</button>
              </div>
              <p class="help">PC 엑셀로 명단을 한꺼번에 입력하려면 빈 양식을 받아 채운 뒤 '불러오기'를 누르세요.</p>
              <input type="file" id="import-file" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" class="hidden">
            </div>

            <h3 class="sec-title">사고접수 번호</h3>
            <div class="panel">
              <p class="help" style="margin-top:0">가입자 화면 아래에 이 번호가 나오고, 누르면 복사됩니다.</p>
              <div class="set-row">
                <input class="input ins-name" data-acc="name" value="${esc(S.accident.name)}" aria-label="보험사 이름">
                <input class="input ins-phone" data-acc="phone" data-phone type="tel" inputmode="numeric" value="${esc(S.accident.phone)}" aria-label="사고접수 번호">
              </div>
            </div>

            <h3 class="sec-title">잠금 비밀번호</h3>
            <div class="panel">
              <p class="help" style="margin-top:0">${S.pinHash ? '앱을 열 때 4자리 비밀번호를 물어봅니다.' : '지금은 잠금을 쓰지 않습니다. 폰을 다른 사람에게 잠시 빌려줄 때를 대비해 설정할 수 있습니다.'}</p>
              <div class="btn-row">
                ${
                  S.pinHash
                    ? `<button type="button" class="btn" data-act="pin-set">비밀번호 바꾸기</button><button type="button" class="btn danger" data-act="pin-off">잠금 끄기</button>`
                    : `<button type="button" class="btn pri" data-act="pin-set">비밀번호 설정하기</button>`
                }
              </div>
            </div>

            <p class="muted small" style="text-align:center;margin-top:1.5rem">고객 수첩 ${APP_VERSION}</p>
          </div>`;
      },
    };
    pushScreen(item);
  }

  // ---------- 엑셀 백업 / 불러오기 ----------
  // 한 줄 = 차 1대 (차 없는 가족은 차 칸을 비운 한 줄)
  const MAIN_HEAD = ['가입자', '가입자휴대폰', '가입자메모', '관계', '운전자', '운전자휴대폰', '차번호', '차종', '만기일', '차량메모'];
  const BACKUP_SHEET = '복원용데이터';
  const HEAD_ALIASES = {
    가입자: ['가입자', '가입자이름', '고객명', '고객', '계약자', '이름', '성명'],
    가입자휴대폰: ['가입자휴대폰', '고객휴대폰', '휴대폰', '전화번호', '연락처', '휴대폰번호', '핸드폰'],
    가입자메모: ['가입자메모', '고객메모', '메모', '비고'],
    관계: ['관계'],
    운전자: ['운전자', '피보험자', '가족', '가족이름', '차주', '소유자'],
    운전자휴대폰: ['운전자휴대폰', '가족휴대폰', '피보험자휴대폰'],
    차번호: ['차번호', '차량번호', '자동차번호'],
    차종: ['차종', '차량', '차명', '모델'],
    만기일: ['만기일', '만기', '보험만기', '만기일자'],
    차량메모: ['차량메모'],
  };

  const cellStr = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  function trimRows(rows) {
    return rows
      .map((r) => {
        const a = (r || []).map(cellStr);
        while (a.length && a[a.length - 1] === '') a.pop();
        return a;
      })
      .filter((r) => r.length);
  }
  function fingerprint(mainRows) {
    const s = JSON.stringify(trimRows(mainRows));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16) + ':' + s.length;
  }

  function buildSheets(template) {
    const list = template ? [] : S.customers.slice().sort((a, b) => collator.compare(a.name, b.name));
    const main = [MAIN_HEAD];
    for (const c of list) {
      const base = [c.name, c.phone, c.memo];
      const before = main.length;
      for (const v of vehiclesOf(c, 'self')) main.push([...base, '본인', c.name, c.phone, v.plate, v.model, v.expiry, v.memo]);
      for (const f of c.family) {
        const vs = vehiclesOf(c, f.id);
        if (vs.length) vs.forEach((v) => main.push([...base, f.relation, f.name, f.phone, v.plate, v.model, v.expiry, v.memo]));
        else main.push([...base, f.relation, f.name, f.phone, '', '', '', '']);
      }
      if (main.length === before) main.push([...base, '본인', c.name, c.phone, '', '', '', '']);
    }
    const sheets = [{ name: '고객목록', rows: main, widths: [10, 15, 20, 8, 10, 15, 12, 12, 12, 20], freezeHeader: true }];
    if (template) {
      sheets.push({
        name: '사용법',
        widths: [100],
        rows: [
          ['[고객목록] 시트는 차 1대당 한 줄씩 적습니다.'],
          ['가입자 = 보험료를 내는 분. 같은 가입자의 줄에는 가입자·가입자휴대폰을 똑같이 적으세요.'],
          ["가입자 본인 차는 관계 칸에 '본인'이라고 적습니다 (운전자 칸은 비워도 됩니다)."],
          ['가족 차는 관계(배우자/자녀/부모/형제자매/기타)와 운전자 이름·휴대폰을 적습니다.'],
          ['차가 없는 가족은 차번호·차종·만기일을 비워 두면 가족으로만 들어갑니다.'],
          ['만기일은 2026-10-03 처럼 적으면 됩니다.'],
          ['다 채웠으면 저장해서 폰으로 보내고, 앱의 설정 > 백업·엑셀 파일 불러오기를 누르세요.'],
        ],
      });
    } else {
      const payload = JSON.stringify({ app: 'customer-book', v: 2, exportedAt: Date.now(), fingerprint: fingerprint(main), customers: S.customers, accident: S.accident });
      const chunks = [['이 시트는 앱에서 되살릴 때 쓰는 자료입니다. 고치거나 지우지 마세요.']];
      for (let i = 0; i < payload.length; i += 30000) chunks.push([payload.slice(i, i + 30000)]);
      sheets.push({ name: BACKUP_SHEET, rows: chunks, widths: [60] });
    }
    return sheets;
  }

  function backupFile() {
    const blob = XlsxLite.write(buildSheets(false));
    return new File([blob], `customer-backup_${isoDate(new Date())}.xlsx`, { type: blob.type });
  }

  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  }

  async function markBackedUp() {
    S.lastBackup = Date.now();
    await DB.setMeta('lastBackup', S.lastBackup);
    refreshAll();
  }

  // 공유용: 크롬(안드로이드)은 .xlsx 파일 공유를 막아서, 엑셀에서 그대로 열리는 .csv로 보냄
  function backupCsvFile() {
    const rows = buildSheets(false)[0].rows;
    const cell = (v) => {
      const t = v === null || v === undefined ? '' : String(v);
      return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const text = '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    return new File([text], `고객수첩_백업_${isoDate(new Date())}.csv`, { type: 'text/csv' });
  }

  async function doBackup(share) {
    if (!S.customers.length) {
      toast('아직 저장된 고객이 없습니다');
      return;
    }
    if (share) {
      const csv = backupCsvFile();
      const can = !!(navigator.share && (!navigator.canShare || navigator.canShare({ files: [csv] })));
      if (can) {
        try {
          await navigator.share({ files: [csv], title: '고객수첩 백업' });
          await markBackedUp();
          toast('백업 파일을 보냈습니다');
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; // 공유 창에서 취소
        }
      }
      const ok = await confirmBox({
        title: '이 화면에서는 바로 보내기가 안 됩니다',
        body: IN_APP
          ? '카카오톡 등 다른 앱 안에서 열린 화면이라 보내기를 쓸 수 없어요.\n홈 화면에 설치한 "고객수첩" 아이콘(또는 크롬)으로 열면 됩니다.\n\n대신 폰에 파일로 저장할까요?'
          : '이 브라우저에서는 파일 보내기가 안 돼요.\n대신 폰의 "다운로드" 폴더에 저장할까요?',
        buttons: [
          { label: '폰에 파일로 저장', value: true, kind: 'pri' },
          { label: '취소', value: false },
        ],
      });
      if (!ok) return;
    }
    download(backupFile());
    await markBackedUp();
    toast('폰의 "다운로드" 폴더에 백업 파일을 저장했습니다');
  }

  function headerIndex(head) {
    const h = head.map((x) => norm(x));
    const idx = {};
    const used = new Set();
    for (const [key, aliases] of Object.entries(HEAD_ALIASES)) {
      idx[key] = -1;
      for (const a of aliases) {
        const i = h.indexOf(norm(a));
        if (i >= 0 && !used.has(i)) {
          idx[key] = i;
          used.add(i);
          break;
        }
      }
    }
    return idx;
  }

  function fromRows(mainRows) {
    const main = mainRows.filter((r) => r && r.some((x) => cellStr(x) !== ''));
    if (!main.length) return [];
    const idx = headerIndex(main[0]);
    if (idx.가입자 < 0) throw new Error('첫 줄에 "가입자" 칸이 있어야 합니다. 빈 엑셀 입력 양식을 참고해 주세요.');
    const get = (row, key) => (idx[key] >= 0 ? cellStr(row[idx[key]]) : '');
    const map = new Map();
    for (const row of main.slice(1)) {
      const name = get(row, '가입자');
      if (!name) continue;
      const key = `${name}|${digits(fmtPhone(get(row, '가입자휴대폰')))}`;
      if (!map.has(key)) map.set(key, { id: uid(), name, phone: get(row, '가입자휴대폰'), memo: '', family: [], vehicles: [] });
      const c = map.get(key);
      if (!c.memo) c.memo = get(row, '가입자메모');

      let rel = get(row, '관계');
      const who = get(row, '운전자');
      let ownerId = 'self';
      if (!(rel === '본인' || (!rel && (!who || who === name)))) {
        if (!rel) rel = '기타';
        let f = c.family.find((x) => x.name === who && x.relation === rel) || c.family.find((x) => x.name === who);
        if (!f) {
          f = { id: uid(), relation: rel, name: who, phone: get(row, '운전자휴대폰') };
          c.family.push(f);
        } else if (!f.phone) f.phone = get(row, '운전자휴대폰');
        ownerId = f.id;
      }
      const v = { id: uid(), ownerId, plate: get(row, '차번호'), model: get(row, '차종'), expiry: normDate(idx.만기일 >= 0 ? row[idx.만기일] : ''), memo: get(row, '차량메모') };
      if (v.plate || v.model || v.expiry || v.memo) c.vehicles.push(v);
    }
    return Array.from(map.values()).map(normalizeCustomer);
  }

  async function parseImport(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      const obj = JSON.parse(await file.text());
      return { customers: (obj.customers || []).map(normalizeCustomer), accident: obj.accident, fromBackup: true };
    }
    let book;
    if (lower.endsWith('.csv')) book = XlsxLite.readCsv(await file.text());
    else if (lower.endsWith('.xls')) throw new Error('예전 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 "다른 이름으로 저장 → .xlsx"로 저장해 주세요.');
    else book = await XlsxLite.read(await file.arrayBuffer());
    const mainName = book.sheetNames.includes('고객목록') ? '고객목록' : book.sheetNames.find((n) => n !== BACKUP_SHEET && n !== '사용법');
    const mainRows = book.sheets[mainName] || [];
    const bk = book.sheets[BACKUP_SHEET];
    if (bk) {
      try {
        const obj = JSON.parse(bk.slice(1).map((r) => cellStr(r && r[0])).join(''));
        // 엑셀에서 고객목록을 고치지 않았을 때만 복원용 자료를 그대로 씀 (고쳤다면 고친 표를 읽음)
        if (obj && obj.app === 'customer-book' && obj.fingerprint === fingerprint(mainRows)) {
          return { customers: (obj.customers || []).map(normalizeCustomer), accident: obj.accident, fromBackup: true };
        }
      } catch {}
    }
    return { customers: fromRows(mainRows), fromBackup: false };
  }

  async function doImport(file) {
    let data;
    try {
      data = await parseImport(file);
    } catch (e) {
      await confirmBox({ title: '파일을 읽지 못했습니다', body: (e && e.message) || String(e), buttons: [{ label: '확인', value: true, kind: 'pri' }] });
      return;
    }
    const n = data.customers.length;
    if (!n) {
      toast('파일에 불러올 고객 정보가 없습니다');
      return;
    }
    const vehN = data.customers.reduce((s, c) => s + c.vehicles.length, 0);
    const choice = await confirmBox({
      title: `가입자 ${n}명 (차량 ${vehN}대)을 불러옵니다`,
      body: S.customers.length
        ? `지금 앱에 가입자 ${S.customers.length}명이 있습니다. 어떻게 할까요?\n(같은 이름·같은 번호의 가입자는 파일 내용으로 바뀝니다)`
        : '불러올까요?',
      buttons: S.customers.length
        ? [
            { label: '지금 목록에 더하기', value: 'merge', kind: 'pri' },
            { label: '지금 목록을 지우고 파일로 바꾸기', value: 'replace', kind: 'danger' },
            { label: '취소', value: null },
          ]
        : [
            { label: '불러오기', value: 'replace', kind: 'pri' },
            { label: '취소', value: null },
          ],
    });
    if (!choice) return;
    const snapshot = clone(S.customers);
    let next;
    if (choice === 'replace') next = data.customers;
    else {
      next = S.customers.slice();
      for (const c of data.customers) {
        let i = next.findIndex((x) => x.id === c.id);
        if (i < 0) i = next.findIndex((x) => x.name === c.name && digits(x.phone) === digits(c.phone));
        if (i >= 0) next[i] = { ...c, id: next[i].id, createdAt: next[i].createdAt };
        else next.push(c);
      }
    }
    await DB.replaceAll(next);
    S.customers = next;
    if (data.fromBackup && data.accident && data.accident.phone) {
      S.accident = { name: str(data.accident.name) || DEFAULT_ACCIDENT.name, phone: fmtPhone(data.accident.phone) };
      await DB.setMeta('accident', S.accident);
    }
    requestPersist();
    refreshAll();
    toast(`가입자 ${n}명을 불러왔습니다`, {
      action: '되돌리기',
      onAction: async () => {
        await DB.replaceAll(snapshot);
        S.customers = snapshot;
        refreshAll();
        toast('불러오기 전으로 되돌렸습니다');
      },
    });
  }

  // ---------- 확인 창 / 알림 ----------
  let openModal = null;
  function confirmBox({ title, body, buttons }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${esc(title)}</h3>
          ${body ? `<p>${esc(body)}</p>` : ''}
          <div class="btns">${buttons.map((b, i) => `<button type="button" class="btn big ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
        </div>`;
      const close = (val) => {
        back.remove();
        openModal = null;
        resolve(val);
      };
      back.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]');
        if (b) close(buttons[+b.dataset.i].value);
        else if (e.target === back) close(null);
      });
      openModal = { close };
      document.body.appendChild(back);
    });
  }

  let toastTimer = null;
  function toast(msg, opt = {}) {
    $$('.toast').forEach((t) => t.remove());
    clearTimeout(toastTimer);
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<span>${esc(msg)}</span>${opt.action ? `<button type="button">${esc(opt.action)}</button>` : ''}`;
    if (opt.action) {
      t.querySelector('button').addEventListener('click', () => {
        t.remove();
        opt.onAction();
      });
    }
    document.body.appendChild(t);
    toastTimer = setTimeout(() => t.remove(), opt.action ? 7000 : 2500);
  }

  // ---------- 잠금 ----------
  async function hashPin(pin) {
    const text = 'customer-book:' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return 'x' + h.toString(16);
  }

  let locked = false;
  function pinPad({ title, sub, onComplete, cancelable, forgot }) {
    const el = document.createElement('div');
    el.className = 'lock';
    let val = '';
    el.innerHTML = `
      <h2>${esc(title)}</h2>
      <div class="lock-sub">${esc(sub || '')}</div>
      <div class="dots">${'<i></i>'.repeat(4)}</div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        ${cancelable ? '<button type="button" class="txt" data-k="cancel">취소</button>' : '<span></span>'}
        <button type="button" data-k="0">0</button>
        <button type="button" class="txt" data-k="del">지우기</button>
      </div>
      ${forgot ? '<button type="button" class="link" data-k="forgot">비밀번호를 잊으셨나요?</button>' : ''}`;
    const dots = () => $$('.dots i', el).forEach((d, i) => d.classList.toggle('on', i < val.length));
    const api = {
      el,
      setSub(text, err) {
        const s = $('.lock-sub', el);
        s.textContent = text;
        s.classList.toggle('err', !!err);
      },
      reset(shake) {
        val = '';
        dots();
        if (shake) {
          const d = $('.dots', el);
          d.classList.remove('shake');
          void d.offsetWidth;
          d.classList.add('shake');
        }
      },
      close() {
        el.remove();
      },
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'del') val = val.slice(0, -1);
      else if (k === 'cancel') return api.close();
      else if (k === 'forgot') return forgot();
      else if (val.length < 4) val += k;
      dots();
      if (val.length === 4) {
        const v = val;
        setTimeout(() => onComplete(v, api), 120);
      }
    });
    document.body.appendChild(el);
    return api;
  }

  function lockNow() {
    if (!S.pinHash || locked) return;
    locked = true;
    pinPad({
      title: '고객 수첩',
      sub: '비밀번호 4자리를 눌러 주세요',
      async onComplete(v, api) {
        if ((await hashPin(v)) === S.pinHash) {
          locked = false;
          api.close();
        } else {
          api.setSub('비밀번호가 틀렸습니다. 다시 눌러 주세요', true);
          api.reset(true);
        }
      },
      forgot: async () => {
        const ok = await confirmBox({
          title: '비밀번호를 잊으셨나요?',
          body: '잠금을 끄면 비밀번호 없이 바로 열립니다.\n고객 정보는 그대로 남아 있습니다.\n필요하면 설정에서 새 비밀번호를 다시 정하세요.',
          buttons: [
            { label: '잠금 끄기', value: true, kind: 'danger' },
            { label: '다시 입력해 보기', value: false, kind: 'pri' },
          ],
        });
        if (!ok) return;
        S.pinHash = null;
        await DB.setMeta('pinHash', null);
        locked = false;
        $$('.lock').forEach((x) => x.remove());
        refreshAll();
      },
    });
  }

  function setPinFlow() {
    let first = null;
    pinPad({
      title: '새 비밀번호',
      sub: '사용할 숫자 4자리를 눌러 주세요',
      cancelable: true,
      async onComplete(v, api) {
        if (first === null) {
          first = v;
          api.setSub('확인을 위해 한 번 더 눌러 주세요');
          api.reset();
          return;
        }
        if (v !== first) {
          first = null;
          api.setSub('두 번 누른 번호가 달라요. 처음부터 다시 눌러 주세요', true);
          api.reset(true);
          return;
        }
        S.pinHash = await hashPin(v);
        await DB.setMeta('pinHash', S.pinHash);
        api.close();
        refreshAll();
        toast('잠금 비밀번호를 설정했습니다');
      },
    });
  }

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (S.pinHash && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) lockNow();
  });

  // ---------- 저장 공간 보호 ----------
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        S.persisted = await navigator.storage.persisted();
        if (!S.persisted && navigator.storage.persist) S.persisted = await navigator.storage.persist();
      }
    } catch {}
  }

  // ---------- 이벤트 ----------
  function rerenderEdit() {
    const top = editTop();
    if (!top || top.type !== 'edit') return;
    const y = top.el.scrollTop;
    top.render();
    top.el.scrollTop = y;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    switch (act) {
      case 'copy':
        copyText(t.dataset.v);
        break;
      case 'font':
        S.font = +t.dataset.v;
        Prefs.set('font', S.font);
        applyFont();
        for (const it of stack) if (it.type === 'settings') it.render();
        break;
      case 'view':
        S.view = t.dataset.v;
        Prefs.set('view', S.view);
        renderControls();
        renderResults();
        break;
      case 'sortdir':
        S.sortDir = -S.sortDir;
        Prefs.set('sortDir', S.sortDir);
        renderControls();
        renderResults();
        break;
      case 'sort-col': {
        const k = t.dataset.k;
        if (S.sortKey === k) S.sortDir = -S.sortDir;
        else {
          S.sortKey = k;
          S.sortDir = 1;
        }
        Prefs.set('sortKey', S.sortKey);
        Prefs.set('sortDir', S.sortDir);
        renderControls();
        renderResults();
        break;
      }
      case 'expiring':
        S.onlyExpiring = !S.onlyExpiring;
        renderControls();
        renderResults();
        break;
      case 'clear-q':
        S.q = '';
        $('#q').value = '';
        renderControls();
        renderResults();
        $('#q').focus();
        break;
      case 'open':
        openDetail(t.dataset.id, t.dataset.vid || null);
        break;
      case 'new':
        openEdit(null);
        break;
      case 'edit':
        openEdit(t.dataset.id);
        break;
      case 'delete':
        deleteCustomer(t.dataset.id);
        break;
      case 'back':
        goBack();
        break;
      case 'save':
        saveDraft();
        break;
      case 'add-fam':
        draft.family.push({ id: uid(), relation: draft.family.length ? '자녀' : '배우자', name: '', phone: '' });
        rerenderEdit();
        setTimeout(() => {
          const blocks = $$('.family-tree [data-fid]', editTop().el);
          const last = blocks[blocks.length - 1];
          if (last) {
            last.scrollIntoView({ block: 'center' });
            $('[data-fam="name"]', last)?.focus();
          }
        }, 30);
        break;
      case 'add-veh': {
        const v = newVehicle(t.dataset.owner);
        draft.vehicles.push(v);
        rerenderEdit();
        setTimeout(() => $(`[data-vid="${v.id}"] [data-veh="plate"]`, editTop().el)?.focus(), 30);
        break;
      }
      case 'rm-fam': {
        const f = draft.family.find((x) => x.id === t.dataset.fid);
        const vs = vehiclesOf(draft, f.id);
        if (f.name || f.phone || vs.length) {
          const ok = await confirmBox({
            title: `${f.name || '이 가족'}을(를) 뺄까요?`,
            body: `${vs.length ? `이 가족의 차량 ${vs.length}대도 함께 빠집니다.\n` : ''}저장을 눌러야 실제로 반영됩니다.`,
            buttons: [
              { label: '빼기', value: true, kind: 'danger' },
              { label: '취소', value: false },
            ],
          });
          if (!ok) return;
        }
        draft.vehicles = draft.vehicles.filter((v) => v.ownerId !== f.id);
        draft.family = draft.family.filter((x) => x.id !== f.id);
        rerenderEdit();
        break;
      }
      case 'rm-veh': {
        const v = draft.vehicles.find((x) => x.id === t.dataset.vid);
        if (v.plate || v.model) {
          const ok = await confirmBox({
            title: `${v.plate || '이 차량'}을(를) 뺄까요?`,
            body: '저장을 눌러야 실제로 반영됩니다.',
            buttons: [
              { label: '빼기', value: true, kind: 'danger' },
              { label: '취소', value: false },
            ],
          });
          if (!ok) return;
        }
        draft.vehicles = draft.vehicles.filter((x) => x.id !== v.id);
        rerenderEdit();
        break;
      }
      case 'settings':
        openSettings();
        break;
      case 'backup':
        doBackup(false);
        break;
      case 'open-chrome':
        openInChrome();
        break;
      case 'backup-share':
        doBackup(true);
        break;
      case 'import':
        $('#import-file').click();
        break;
      case 'template': {
        const blob = XlsxLite.write(buildSheets(true));
        download(new File([blob], 'customer-template.xlsx', { type: blob.type }));
        toast('폰의 "다운로드" 폴더에 양식을 저장했습니다');
        break;
      }
      case 'pin-set':
        setPinFlow();
        break;
      case 'pin-off': {
        const ok = await confirmBox({
          title: '잠금을 끌까요?',
          body: '앱을 열 때 비밀번호를 묻지 않습니다.',
          buttons: [
            { label: '잠금 끄기', value: true, kind: 'danger' },
            { label: '취소', value: false },
          ],
        });
        if (!ok) return;
        S.pinHash = null;
        await DB.setMeta('pinHash', null);
        refreshAll();
        toast('잠금을 껐습니다');
        break;
      }
    }
  });

  let qTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') {
      S.q = t.value;
      $('.clear').classList.toggle('hidden', !S.q);
      clearTimeout(qTimer);
      qTimer = setTimeout(renderResults, 80);
      return;
    }
    if (t.hasAttribute('data-phone')) applyLivePhone(t);
    if (!draft) return;
    if (t.dataset.f) {
      draft[t.dataset.f] = t.value;
    } else if (t.dataset.fam) {
      const f = draft.family.find((x) => x.id === t.closest('[data-fid]').dataset.fid);
      f[t.dataset.fam] = t.value;
      if (t.dataset.fam === 'name') {
        const lab = $('[data-fam-label]', t.closest('[data-fid]'));
        if (lab) lab.textContent = t.value || '이 가족';
      }
    } else if (t.dataset.veh) {
      const v = draft.vehicles.find((x) => x.id === t.closest('[data-vid]').dataset.vid);
      v[t.dataset.veh] = t.value;
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'sort') {
      S.sortKey = t.value;
      S.sortDir = t.value === 'createdAt' || t.value === 'updatedAt' ? -1 : 1;
      Prefs.set('sortKey', S.sortKey);
      Prefs.set('sortDir', S.sortDir);
      renderControls();
      renderResults();
      return;
    }
    if (t.id === 'import-file') {
      const f = t.files && t.files[0];
      t.value = '';
      if (f) doImport(f);
      return;
    }
    if (t.dataset.acc) {
      S.accident[t.dataset.acc] = t.dataset.acc === 'phone' ? fmtPhone(t.value) : str(t.value);
      await DB.setMeta('accident', S.accident);
      toast('사고접수 번호를 저장했습니다');
      return;
    }
    // 칸을 벗어날 때 번호 모양 최종 정리
    if (draft && t.hasAttribute('data-phone')) {
      const f = fmtPhone(t.value);
      if (f !== t.value) {
        t.value = f;
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (draft && (t.tagName === 'SELECT' || t.type === 'date')) t.dispatchEvent(new Event('input', { bubbles: true }));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'q') e.target.blur();
  });

  // ---------- 시작 ----------
  async function start() {
    try {
      await DB.open();
      const [customers, accident, lastBackup, pinHash] = await Promise.all([
        DB.all('customers'),
        DB.getMeta('accident', null),
        DB.getMeta('lastBackup', null),
        DB.getMeta('pinHash', null),
      ]);
      S.customers = (customers || []).map(normalizeCustomer);
      if (accident && accident.phone) S.accident = accident;
      S.lastBackup = lastBackup;
      S.pinHash = pinHash;
    } catch (e) {
      $('#app').innerHTML = `<div class="empty"><b>저장 공간을 열 수 없습니다</b>${esc(e && e.message)}<br>크롬이나 삼성 인터넷의 '비밀 모드'에서는 쓸 수 없습니다.</div>`;
      return;
    }
    history.replaceState({ depth: 0 }, '');
    renderShell();
    lockNow();
    if (S.customers.length) requestPersist();
    else if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((p) => (S.persisted = p)).catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // 테스트용 진입점
  window.__cb = { S, DB, fmtPhone, fmtPhoneLive, normDate, toCho, fingerprint, buildSheets, parseImport };

  start();
})();
