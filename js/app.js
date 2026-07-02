/* =========================================================================
 *  보도자료 배포 일정 캘린더 - 메인 로직
 * ========================================================================= */
(function () {
  "use strict";

  /* ---------- 상수 ---------- */
  const STATUSES = ["접수", "수정중", "배포예정", "배포완료"];
  const STATUS_COLOR = {
    "접수": "#64748b",
    "수정중": "#f59e0b",
    "배포예정": "#3b82f6",
    "배포완료": "#22c55e",
  };
  const STATUS_DESC = {
    "접수": "보도자료 작성 요청이 접수된 상태",
    "수정중": "내용 검토·수정이 진행 중인 상태",
    "배포예정": "검토 완료, 배포 일정이 확정된 상태",
    "배포완료": "언론·채널로 배포가 완료된 상태",
  };
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const API_URL =
    window.CONFIG && CONFIG.API_URL && !CONFIG.API_URL.includes("여기에")
      ? CONFIG.API_URL.trim()
      : "";
  const DEMO = !API_URL;
  const DEMO_KEY = "pr_calendar_demo_events";
  // 실제 운영 시 관리자 비밀번호는 서버(Apps Script)에서만 검증하며,
  // 이 프론트엔드 코드에는 비밀번호를 저장하지 않습니다.

  /* ---------- 상태 ---------- */
  let events = [];
  let viewDate = new Date();
  viewDate.setDate(1);
  let isAdmin = false;
  let activeFilters = new Set(STATUSES);

  /* ---------- DOM ---------- */
  const $ = (sel) => document.querySelector(sel);
  const el = {
    banner: $("#banner"),
    modeBadge: $("#modeBadge"),
    adminBtn: $("#adminBtn"),
    addBtn: $("#addBtn"),
    prevBtn: $("#prevBtn"),
    nextBtn: $("#nextBtn"),
    todayBtn: $("#todayBtn"),
    monthLabel: $("#monthLabel"),
    filters: $("#filters"),
    calendar: $("#calendar"),
    upcoming: $("#upcoming"),
    legend: $("#legend"),
    formModal: $("#formModal"),
    detailModal: $("#detailModal"),
    eventForm: $("#eventForm"),
    formTitle: $("#formTitle"),
    saveBtn: $("#saveBtn"),
    detailBody: $("#detailBody"),
    detailActions: $("#detailActions"),
    toast: $("#toast"),
  };

  /* ---------- 유틸 ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const todayStr = () => ymd(new Date());

  // 서버(구글 시트)가 날짜를 어떤 형식으로 돌려주더라도 항상 YYYY-MM-DD 로 맞춘다.
  // 예) "Thu Jul 02 2026 00:00:00 GMT+0900 (한국 표준시)", ISO 문자열, Date 등
  const MONTHS = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  function normalizeDate(v) {
    if (!v) return "";
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // 이미 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10); // ISO
    // JS Date.toString() 형식에서 월/일/연을 직접 추출 (타임존 영향 없음)
    const m = s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})\b/);
    if (m) return `${m[3]}-${MONTHS[m[1]]}-${pad(Number(m[2]))}`;
    // 마지막 수단: Date 파싱 (로컬 기준)
    const d = new Date(s);
    if (!isNaN(d.getTime())) return ymd(d);
    return s;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let toastTimer = null;
  function toast(msg, type) {
    el.toast.textContent = msg;
    el.toast.className = "toast" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2600);
  }

  function showBanner(msg, isError) {
    el.banner.textContent = msg;
    el.banner.className = "banner" + (isError ? " error" : "");
  }

  /* ---------- API 계층 ---------- */
  async function apiGet() {
    if (DEMO) {
      return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]");
    }
    const res = await fetch(API_URL, { method: "GET" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "조회 실패");
    return data.events || [];
  }

  // POST 는 text/plain 본문(단순 요청)으로 보내 CORS 프리플라이트를 피한다.
  async function apiPost(payload) {
    if (DEMO) return demoPost(payload);
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "요청 실패");
    return data;
  }

  function demoPost(payload) {
    const list = JSON.parse(localStorage.getItem(DEMO_KEY) || "[]");
    // 데모 모드(localStorage)는 로컬 테스트 전용이라 서버가 없어 비밀번호를
    // 검증하지 않습니다. 실제 검증은 Apps Script 연동 후 서버에서 이뤄집니다.
    if (payload.action === "auth") {
      return { ok: !!payload.password };
    }
    if (payload.action === "add") {
      const ev = Object.assign({}, payload.event, {
        id: "demo-" + Date.now() + "-" + Math.floor(performance.now()),
      });
      list.push(ev);
      localStorage.setItem(DEMO_KEY, JSON.stringify(list));
      return { ok: true, event: ev };
    }
    if (payload.action === "update") {
      const i = list.findIndex((e) => e.id === payload.event.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], payload.event);
      localStorage.setItem(DEMO_KEY, JSON.stringify(list));
      return { ok: true };
    }
    if (payload.action === "delete") {
      const next = list.filter((e) => e.id !== payload.id);
      localStorage.setItem(DEMO_KEY, JSON.stringify(next));
      return { ok: true };
    }
    throw new Error("알 수 없는 작업");
  }

  /* ---------- 데이터 로드 ---------- */
  async function loadEvents() {
    try {
      const raw = await apiGet();
      // 날짜를 항상 YYYY-MM-DD 로 정규화해 캘린더 비교가 정확하도록 한다.
      events = raw.map((e) =>
        Object.assign({}, e, { date: normalizeDate(e.date) })
      );
      render();
    } catch (err) {
      console.error(err);
      showBanner("데이터를 불러오지 못했습니다: " + err.message, true);
    }
  }

  /* ---------- 관리자 세션 ---------- */
  function getAdminPw() {
    return sessionStorage.getItem("pr_admin_pw") || "";
  }
  function setAdminSession(pw) {
    isAdmin = true;
    sessionStorage.setItem("pr_admin_pw", pw);
    updateAdminUI();
  }
  function clearAdminSession() {
    isAdmin = false;
    sessionStorage.removeItem("pr_admin_pw");
    updateAdminUI();
  }
  function updateAdminUI() {
    if (isAdmin) {
      el.modeBadge.textContent = "🔧 관리자 모드";
      el.modeBadge.className = "mode-badge admin";
      el.adminBtn.textContent = "관리자 해제";
      el.addBtn.classList.remove("hidden");
    } else {
      el.modeBadge.textContent = "👀 보기 모드";
      el.modeBadge.className = "mode-badge view";
      el.adminBtn.textContent = "🔑 관리자 모드";
      el.addBtn.classList.add("hidden");
    }
    render();
  }

  async function toggleAdmin() {
    if (isAdmin) {
      clearAdminSession();
      toast("보기 모드로 전환되었습니다.");
      return;
    }
    const pw = window.prompt("관리자 비밀번호를 입력하세요.");
    if (pw == null) return;
    try {
      const res = await apiPost({ action: "auth", password: pw });
      if (res.ok) {
        setAdminSession(pw);
        toast("관리자 모드로 전환되었습니다.", "success");
      } else {
        toast("비밀번호가 올바르지 않습니다.", "error");
      }
    } catch (err) {
      toast("인증 실패: " + err.message, "error");
    }
  }

  /* ---------- 필터 렌더 ---------- */
  function renderFilters() {
    el.filters.innerHTML = "";
    STATUSES.forEach((st) => {
      const chip = document.createElement("span");
      const on = activeFilters.has(st);
      chip.className = "filter-chip" + (on ? "" : " off");
      chip.style.background = on ? STATUS_COLOR[st] + "22" : "#f1f5f9";
      chip.style.borderColor = STATUS_COLOR[st];
      chip.style.color = on ? STATUS_COLOR[st] : "#94a3b8";
      chip.innerHTML =
        `<span class="dot" style="background:${STATUS_COLOR[st]}"></span>${st}`;
      chip.onclick = () => {
        if (activeFilters.has(st)) activeFilters.delete(st);
        else activeFilters.add(st);
        if (activeFilters.size === 0) activeFilters = new Set(STATUSES);
        render();
      };
      el.filters.appendChild(chip);
    });
  }

  /* ---------- 범례 렌더 ---------- */
  function renderLegend() {
    el.legend.innerHTML = STATUSES.map(
      (st) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${STATUS_COLOR[st]}"></span>
        <div>
          <strong>${st}</strong>
          <div class="legend-desc">${STATUS_DESC[st]}</div>
        </div>
      </div>`
    ).join("");
  }

  /* ---------- 달력 렌더 ---------- */
  function eventsOn(dateStr) {
    return events
      .filter((e) => e.date === dateStr && activeFilters.has(e.status))
      .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    el.monthLabel.textContent = `${year}년 ${month + 1}월`;

    const first = new Date(year, month, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
    const today = todayStr();

    let html = "";
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startWeekday + 1;
      const cellDate = new Date(year, month, dayNum);
      const dateStr = ymd(cellDate);
      const isOther = dayNum < 1 || dayNum > daysInMonth;
      const weekday = cellDate.getDay();

      const classes = ["day-cell"];
      if (isOther) classes.push("other");
      if (dateStr === today) classes.push("today");
      if (weekday === 0) classes.push("sun");
      if (weekday === 6) classes.push("sat");
      if (isAdmin && !isOther) classes.push("clickable");

      const dayEvents = eventsOn(dateStr);
      const shown = dayEvents.slice(0, 3);
      const rest = dayEvents.length - shown.length;

      let chips = shown
        .map(
          (ev) => `
          <div class="event-chip" data-id="${ev.id}"
               style="background:${STATUS_COLOR[ev.status]}" title="${esc(ev.title)}">
            <span class="chip-status">[${ev.status}]</span>
            <span>${esc(ev.title)}</span>
          </div>`
        )
        .join("");
      if (rest > 0) {
        chips += `<span class="more-link" data-date="${dateStr}">+${rest}건 더보기</span>`;
      }

      html += `
        <div class="${classes.join(" ")}" data-date="${dateStr}" data-other="${isOther}">
          <span class="day-num">${cellDate.getDate()}</span>
          <div class="day-events">${chips}</div>
        </div>`;
    }
    el.calendar.innerHTML = html;
  }

  /* ---------- 다가오는 일정 ---------- */
  function renderUpcoming() {
    const today = todayStr();
    const list = events
      .filter((e) => e.date >= today && e.status !== "배포완료")
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);

    if (list.length === 0) {
      el.upcoming.innerHTML =
        '<div class="upcoming-empty">예정된 일정이 없습니다.</div>';
      return;
    }
    el.upcoming.innerHTML = list
      .map((ev) => {
        const d = parseYmd(ev.date);
        const wk = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
        const dLeft = Math.round((d - parseYmd(today)) / (24 * 60 * 60 * 1000));
        const dTxt = dLeft === 0 ? "오늘" : `D-${dLeft}`;
        return `
        <div class="upcoming-item" data-id="${ev.id}"
             style="border-left-color:${STATUS_COLOR[ev.status]}">
          <div class="upcoming-top">
            <span class="upcoming-date">${d.getMonth() + 1}/${d.getDate()}(${wk}) · ${dTxt}</span>
            <span class="status-badge" style="background:${STATUS_COLOR[ev.status]}">${ev.status}</span>
          </div>
          <div class="upcoming-title">${esc(ev.title)}</div>
        </div>`;
      })
      .join("");
  }

  function render() {
    renderFilters();
    renderCalendar();
    renderUpcoming();
    renderLegend();
  }

  /* ---------- 모달 ---------- */
  function openModal(node) { node.classList.remove("hidden"); }
  function closeModal(node) { node.classList.add("hidden"); }

  function openForm(ev, presetDate) {
    el.eventForm.reset();
    if (ev) {
      el.formTitle.textContent = "일정 수정";
      $("#f-id").value = ev.id;
      $("#f-title").value = ev.title;
      $("#f-date").value = ev.date;
      $("#f-status").value = ev.status;
      $("#f-dept").value = ev.department || "";
      $("#f-manager").value = ev.manager || "";
      $("#f-memo").value = ev.memo || "";
    } else {
      el.formTitle.textContent = "일정 등록";
      $("#f-id").value = "";
      $("#f-date").value = presetDate || todayStr();
      $("#f-status").value = "접수";
    }
    openModal(el.formModal);
    setTimeout(() => $("#f-title").focus(), 50);
  }

  async function submitForm(e) {
    e.preventDefault();
    const title = $("#f-title").value.trim();
    const date = $("#f-date").value;
    if (!title) { toast("제목을 입력하세요.", "error"); return; }
    if (!date) { toast("배포(예정)일을 선택하세요.", "error"); return; }

    const id = $("#f-id").value;
    const ev = {
      title: title,
      date: date,
      status: $("#f-status").value,
      department: $("#f-dept").value.trim(),
      manager: $("#f-manager").value.trim(),
      memo: $("#f-memo").value.trim(),
    };
    if (id) ev.id = id;

    el.saveBtn.disabled = true;
    el.saveBtn.textContent = "저장 중...";
    try {
      await apiPost({
        action: id ? "update" : "add",
        password: getAdminPw(),
        event: ev,
      });
      closeModal(el.formModal);
      toast(id ? "일정이 수정되었습니다." : "일정이 등록되었습니다.", "success");
      await loadEvents();
    } catch (err) {
      toast("저장 실패: " + err.message, "error");
    } finally {
      el.saveBtn.disabled = false;
      el.saveBtn.textContent = "저장";
    }
  }

  function openDetail(id) {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const d = parseYmd(ev.date);
    const wk = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];

    el.detailBody.innerHTML = `
      <div class="detail-title">${esc(ev.title)}</div>
      <div class="detail-row">
        <span class="label">상태</span>
        <span class="value">
          <span class="status-badge" style="background:${STATUS_COLOR[ev.status]}">${ev.status}</span>
        </span>
      </div>
      <div class="detail-row">
        <span class="label">배포일</span>
        <span class="value">${ev.date} (${wk})</span>
      </div>
      <div class="detail-row">
        <span class="label">담당부서</span>
        <span class="value">${esc(ev.department) || "-"}</span>
      </div>
      <div class="detail-row">
        <span class="label">담당자</span>
        <span class="value">${esc(ev.manager) || "-"}</span>
      </div>
      <div class="detail-row">
        <span class="label">비고</span>
        <span class="value">${esc(ev.memo) || "-"}</span>
      </div>
    `;

    if (isAdmin) {
      el.detailActions.innerHTML = `
        <button class="btn btn-danger" id="detailDelete">삭제</button>
        <button class="btn btn-primary" id="detailEdit">수정</button>`;
      el.detailActions.classList.remove("hidden");
      $("#detailEdit").onclick = () => {
        closeModal(el.detailModal);
        openForm(ev);
      };
      $("#detailDelete").onclick = () => deleteEvent(ev);
    } else {
      el.detailActions.innerHTML = "";
      el.detailActions.classList.add("hidden");
    }
    openModal(el.detailModal);
  }

  async function deleteEvent(ev) {
    if (!window.confirm(`"${ev.title}" 일정을 삭제하시겠습니까?`)) return;
    try {
      await apiPost({ action: "delete", password: getAdminPw(), id: ev.id });
      closeModal(el.detailModal);
      toast("일정이 삭제되었습니다.", "success");
      await loadEvents();
    } catch (err) {
      toast("삭제 실패: " + err.message, "error");
    }
  }

  /* ---------- 이벤트 바인딩 ---------- */
  function bindEvents() {
    el.adminBtn.onclick = toggleAdmin;
    el.addBtn.onclick = () => openForm(null);
    el.prevBtn.onclick = () => {
      viewDate.setMonth(viewDate.getMonth() - 1);
      renderCalendar();
    };
    el.nextBtn.onclick = () => {
      viewDate.setMonth(viewDate.getMonth() + 1);
      renderCalendar();
    };
    el.todayBtn.onclick = () => {
      viewDate = new Date();
      viewDate.setDate(1);
      renderCalendar();
    };
    el.eventForm.onsubmit = submitForm;

    // 달력 클릭(위임)
    el.calendar.onclick = (e) => {
      const chip = e.target.closest(".event-chip");
      if (chip) { openDetail(chip.dataset.id); return; }
      const more = e.target.closest(".more-link");
      if (more) {
        // 해당 날짜 첫 일정 상세로 안내 대신, 관리자면 등록/보기 편의상 그 날짜 이벤트 목록을 상세로
        const first = eventsOn(more.dataset.date)[0];
        if (first) openDetail(first.id);
        return;
      }
      const cell = e.target.closest(".day-cell");
      if (cell && isAdmin && cell.dataset.other === "false") {
        openForm(null, cell.dataset.date);
      }
    };

    // 다가오는 일정 클릭
    el.upcoming.onclick = (e) => {
      const item = e.target.closest(".upcoming-item");
      if (item) openDetail(item.dataset.id);
    };

    // 모달 닫기
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.onclick = () => closeModal($("#" + btn.dataset.close));
    });
    [el.formModal, el.detailModal].forEach((m) => {
      m.onclick = (e) => { if (e.target === m) closeModal(m); };
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal(el.formModal);
        closeModal(el.detailModal);
      }
    });
  }

  /* ---------- 초기화 ---------- */
  async function init() {
    if (DEMO) {
      showBanner(
        "⚠️ 데모 모드입니다. js/config.js 에 Apps Script 웹앱 URL을 넣으면 " +
          "구글 스프레드시트와 연동됩니다. (데모에서는 아무 비밀번호나 입력하면 " +
          "관리자 모드로 전환되며, 실제 비밀번호 검증은 연동 후 서버에서 이뤄집니다.)",
        false
      );
    } else {
      el.banner.classList.add("hidden");
    }
    bindEvents();

    // 저장된 관리자 세션이 있으면 서버로 다시 확인한다.
    // (서버 비밀번호가 미설정/변경된 경우, 관리자로 보이지만 저장이 실패하는
    //  혼란을 막기 위해 세션을 자동으로 해제한다.)
    if (getAdminPw()) {
      if (DEMO) {
        isAdmin = true;
      } else {
        try {
          const res = await apiPost({ action: "auth", password: getAdminPw() });
          isAdmin = !!res.ok;
          if (!res.ok) sessionStorage.removeItem("pr_admin_pw");
        } catch (e) {
          isAdmin = false;
        }
      }
    }
    updateAdminUI();
    loadEvents();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
