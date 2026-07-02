/**
 * =========================================================================
 *  보도자료 배포 일정 캘린더 - Google Apps Script 백엔드
 *  -------------------------------------------------------------------------
 *  구글 스프레드시트를 데이터베이스로 사용하는 웹앱 API입니다.
 *
 *  [설치 방법]
 *   1. 구글 스프레드시트를 하나 만듭니다.
 *   2. 확장 프로그램 > Apps Script 를 열고, 이 파일 내용을 전부 붙여넣습니다.
 *   3. 함수 목록에서 setup 을 선택해 한 번 실행합니다.
 *      (권한 승인 창이 뜨면 허용 → 시트/속성이 자동 생성됩니다.)
 *   4. 배포 > 새 배포 > 유형: 웹 앱
 *        - 실행 계정: 나
 *        - 액세스 권한: 모든 사용자
 *      → 배포 후 나오는 "웹 앱 URL"을 프론트엔드 js/config.js 에 붙여넣습니다.
 *   5. 관리자 비밀번호 설정:
 *      setPassword 함수의 newPassword 값(따옴표 안)에 원하는 비밀번호를
 *      적은 뒤, 함수 목록에서 setPassword 를 선택해 한 번 실행하세요.
 *      ※ 이 편집은 "여기 Apps Script 편집기"에서만 하세요. 비밀번호를 GitHub
 *        공개 저장소에 올리지 않습니다. (Apps Script는 GitHub와 별개의 공간)
 * =========================================================================
 */

var SHEET_NAME = "일정";
var HEADERS = [
  "id",
  "title",
  "date",
  "status",
  "department",
  "manager",
  "memo",
  "createdAt",
  "updatedAt",
];
// ⚠️ 보안: 실제 관리자 비밀번호는 절대 이 파일에 적지 않습니다.
//    비밀번호는 스크립트 속성(ADMIN_PASSWORD)에만 저장되며, 이 값은 비워 둡니다.
//    (이 저장소는 공개(public)이므로 여기에 비밀번호를 적으면 노출됩니다.)
var DEFAULT_PASSWORD = "";

/* ---------- 초기 설정 ---------- */
function setup() {
  getSheet();
  var pw = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (pw) {
    Logger.log("설정 완료. 관리자 비밀번호가 등록되어 있습니다.");
  } else {
    Logger.log(
      "⚠️ 시트는 준비됐지만 관리자 비밀번호가 아직 없습니다.\n" +
        "   setPassword 함수의 newPassword 값에 비밀번호를 적고 한 번 실행하세요."
    );
  }
}

/**
 * 관리자 비밀번호 설정.
 * 아래 따옴표 "" 안에 원하는 비밀번호를 적고 이 함수를 한 번 실행하세요.
 * ※ 이 편집은 Apps Script 편집기 안에서만 하고, GitHub에는 올리지 마세요.
 */
function setPassword() {
  var newPassword = ""; // ← 여기에 비밀번호 입력 후 실행 (예: "mypassword")
  if (!newPassword) {
    Logger.log("먼저 newPassword 값에 비밀번호를 입력하세요.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", newPassword);
  Logger.log("비밀번호가 설정되었습니다.");
}

/* ---------- 공통 ---------- */
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    // 날짜 열이 자동으로 날짜 서식으로 바뀌지 않도록 텍스트 서식 지정
    sh.getRange("C:C").setNumberFormat("@");
  }
  return sh;
}

function getPassword() {
  return (
    PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD") ||
    DEFAULT_PASSWORD
  );
}

function checkPassword(pw) {
  var stored = getPassword();
  if (!stored) return false; // 비밀번호가 설정되지 않으면 모든 관리자 작업 거부
  return String(pw) === stored;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function fmtDate(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  return String(v == null ? "" : v);
}

/* ---------- 읽기 ---------- */
function readEvents() {
  var sh = getSheet();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var idx = {};
  HEADERS.forEach(function (h) {
    idx[h] = head.indexOf(h);
  });
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[idx.id]) continue;
    out.push({
      id: String(row[idx.id]),
      title: String(row[idx.title] || ""),
      date: fmtDate(row[idx.date], tz),
      status: String(row[idx.status] || "접수"),
      department: String(row[idx.department] || ""),
      manager: String(row[idx.manager] || ""),
      memo: String(row[idx.memo] || ""),
    });
  }
  return out;
}

function findRowById(sh, id) {
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) return r + 1; // 1-based 행 번호
  }
  return -1;
}

/* ---------- 쓰기 ---------- */
function addEvent(ev) {
  var sh = getSheet();
  var now = new Date().toISOString();
  var id = Utilities.getUuid();
  var rowObj = {
    id: id,
    title: ev.title || "",
    date: ev.date || "",
    status: ev.status || "접수",
    department: ev.department || "",
    manager: ev.manager || "",
    memo: ev.memo || "",
    createdAt: now,
    updatedAt: now,
  };
  var row = HEADERS.map(function (h) {
    return rowObj[h];
  });
  sh.appendRow(row);
  return rowObj;
}

function updateEvent(ev) {
  var sh = getSheet();
  var rowNum = findRowById(sh, ev.id);
  if (rowNum < 0) throw new Error("해당 일정을 찾을 수 없습니다.");
  var fields = ["title", "date", "status", "department", "manager", "memo"];
  fields.forEach(function (f) {
    if (ev[f] !== undefined) {
      var col = HEADERS.indexOf(f) + 1;
      sh.getRange(rowNum, col).setValue(ev[f]);
    }
  });
  sh.getRange(rowNum, HEADERS.indexOf("updatedAt") + 1).setValue(
    new Date().toISOString()
  );
  return ev;
}

function deleteEvent(id) {
  var sh = getSheet();
  var rowNum = findRowById(sh, id);
  if (rowNum < 0) throw new Error("해당 일정을 찾을 수 없습니다.");
  sh.deleteRow(rowNum);
  return true;
}

/* ---------- 웹앱 엔드포인트 ---------- */
function doGet(e) {
  try {
    return jsonOut({ ok: true, events: readEvents() });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "auth") {
      return jsonOut({ ok: checkPassword(body.password) });
    }

    // 이하 작업은 모두 관리자 인증 필요
    if (!checkPassword(body.password)) {
      return jsonOut({ ok: false, error: "비밀번호가 올바르지 않습니다." });
    }

    if (action === "add") {
      return jsonOut({ ok: true, event: addEvent(body.event) });
    }
    if (action === "update") {
      return jsonOut({ ok: true, event: updateEvent(body.event) });
    }
    if (action === "delete") {
      return jsonOut({ ok: deleteEvent(body.id) });
    }
    return jsonOut({ ok: false, error: "알 수 없는 작업입니다." });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}
