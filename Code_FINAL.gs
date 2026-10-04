/**
 * BKCIT AI COURSE REGISTRATION — Code.gs
 * Backend tương thích với index.html nguồn của người dùng.
 *
 * NGUYÊN TẮC:
 * - Không thay đổi nội dung/đồ họa frontend.
 * - Nhận POST field: payload = JSON.stringify(data)
 * - Ghi Google Sheets.
 * - Chống ghi trùng theo clientRequestId.
 * - Sinh mã đăng ký.
 * - Trả kết quả qua postMessage để iframe ẩn trên GitHub Pages nhận được.
 */

const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1p3WtazZj7N5VJ6qhUqrMcsXHBpNXb2lyWaY2ASqx7lc',
  PRIMARY_SHEET: 'DANG_KY',
  FALLBACK_SHEET: 'DANG_KY_WEB',
  TIME_ZONE: 'Asia/Ho_Chi_Minh',
  REG_PREFIX: 'AI',
  FRONTEND_ORIGIN: 'https://ducanhbkcit.github.io',
  FRONTEND_PAGE: 'https://ducanhbkcit.github.io/dangkykhoahoc2026/'
});

/**
 * Đối soát 1:1 với COURSES trong index.html nguồn.
 * Không thay đổi học phí, số buổi, thời lượng, tên khóa.
 */
const COURSES = Object.freeze({
  K01: Object.freeze({
    code: 'K01',
    name: 'AI Mầm non',
    totalFee: 489000,
    sessions: 10,
    hoursPerSession: 2,
    totalHours: 20,
    months: 1
  }),
  K02: Object.freeze({
    code: 'K02',
    name: 'AI Dành cho học sinh lớp 6–9',
    totalFee: 489000,
    sessions: 10,
    hoursPerSession: 2,
    totalHours: 20,
    months: 1
  }),
  K03: Object.freeze({
    code: 'K03',
    name: 'AI Hành chính Nhà nước',
    totalFee: 990000,
    sessions: 12,
    hoursPerSession: 2,
    totalHours: 24,
    months: 1
  }),
  K04: Object.freeze({
    code: 'K04',
    name: 'AI Thực chiến Hành chính Nhà nước',
    totalFee: 990000,
    sessions: 8,
    hoursPerSession: 3,
    totalHours: 24,
    months: 1
  })
});

const HEADERS = Object.freeze([
  'Mã đăng ký',
  'Thời điểm',
  'Client Request ID',
  'Nguồn',
  'UTM Source',
  'UTM Medium',
  'UTM Campaign',
  'Page URL',
  'Referrer',
  'Họ và tên',
  'SĐT / Zalo',
  'Email',
  'Cơ quan / Trường',
  'Tỉnh / Thành',
  'Mức độ sử dụng AI',
  'Mã khóa học',
  'Tên khóa học',
  'Học phí',
  'Số buổi',
  'Giờ / buổi',
  'Tổng giờ',
  'Thời lượng dự kiến (tháng)',
  'Lớp',
  'Họ tên phụ huynh / người giám hộ',
  'SĐT phụ huynh / người giám hộ',
  'Mục tiêu / mong muốn',
  'Đồng ý tham gia',
  'Xác nhận điều khoản',
  'Xác nhận phụ huynh',
  'Trạng thái'
]);

/**
 * Health check.
 * Sau khi Deploy Web App, mở URL /exec trên trình duyệt.
 */
function doGet() {
  const body = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>BKCIT Registration API</title></head>',
    '<body style="font-family:Arial,sans-serif;background:#07111f;color:#fff;padding:40px">',
    '<h2 style="color:#00f2fe">BKCIT Registration API ✓</h2>',
    '<p>Backend Google Apps Script đang hoạt động.</p>',
    '<p>Spreadsheet ID: <code>', escapeHtml_(CONFIG.SPREADSHEET_ID), '</code></p>',
    '<p>Sheet: <code>', escapeHtml_(CONFIG.PRIMARY_SHEET), '</code></p>',
    '</body></html>'
  ].join('');

  return HtmlService
    .createHtmlOutput(body)
    .setTitle('BKCIT Registration API');
}

/**
 * Nhận POST từ index.html.
 */
function doPost(e) {
  let result;
  let frontendPage = CONFIG.FRONTEND_PAGE;

  try {
    const raw = e && e.parameter ? e.parameter.payload : '';
    if (!raw) {
      throw new Error('Không nhận được trường payload từ biểu mẫu.');
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      throw new Error('Payload không phải JSON hợp lệ.');
    }

    frontendPage = allowedFrontendPage_(data.pageUrl);
    result = submitRegistration(data);

  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    result = {
      success: false,
      message: err && err.message ? err.message : 'Lỗi backend không xác định.'
    };
  }

  return responseBridge_(result, frontendPage);
}

/**
 * Hàm nghiệp vụ chính.
 * Có thể gọi bằng google.script.run nếu sau này frontend được host trong Apps Script.
 */
function submitRegistration(data) {
  validatePayload_(data);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ensureRegistrationSheet_(ss);

    const requestId = safe_(data.clientRequestId, 160);

    // Idempotency: cùng clientRequestId không tạo thêm dòng.
    if (requestId) {
      const duplicateResult = findExistingByRequestId_(sheet, requestId);
      if (duplicateResult) {
        return duplicateResult;
      }
    }

    const course = COURSES[data.courseCode];
    const now = new Date();
    const registrationId = nextRegistrationId_(sheet, now);
    const timestampText = Utilities.formatDate(
      now,
      CONFIG.TIME_ZONE,
      'dd/MM/yyyy HH:mm:ss'
    );

    const fullName = safe_(data.fullName, 120);
    const phone = normalizePhone_(data.phone);
    const email = safe_(data.email, 160);
    const organization = safe_(data.organization, 160);
    const province = safe_(data.province, 90);
    const aiLevel = safe_(data.aiLevel, 80);
    const grade = safe_(data.grade, 10);
    const guardianName = safe_(data.guardianName, 120);
    const guardianPhone = data.guardianPhone
      ? normalizePhone_(data.guardianPhone)
      : '';
    const learningGoal = safe_(data.learningGoal, 800);

    const row = [
      registrationId,
      now,
      requestId,
      safe_(data.source, 80),
      safe_(data.utmSource, 120),
      safe_(data.utmMedium, 120),
      safe_(data.utmCampaign, 160),
      safe_(data.pageUrl, 500),
      safe_(data.referrer, 500),
      fullName,
      phone,
      email,
      organization,
      province,
      aiLevel,
      course.code,
      course.name,
      course.totalFee,
      course.sessions,
      course.hoursPerSession,
      course.totalHours,
      course.months,
      grade,
      guardianName,
      guardianPhone,
      learningGoal,
      data.privacyConsent === true ? 'Có' : 'Không',
      data.termsConsent === true ? 'Có' : 'Không',
      data.guardianConsent === true ? 'Có' : 'Không',
      'Đã đăng ký'
    ];

    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(lastRow, 18).setNumberFormat('#,##0" ₫"');
    SpreadsheetApp.flush();

    return {
      success: true,
      registrationId: registrationId,
      timestamp: timestampText,
      fullName: fullName,
      phone: phone,
      courseCode: course.code,
      courseName: course.name,
      totalFee: course.totalFee,
      projectedTotal: course.totalFee,
      sessions: course.sessions,
      plannedSessions: course.sessions,
      hoursPerSession: course.hoursPerSession,
      totalHours: course.totalHours,
      months: course.months
    };

  } finally {
    lock.releaseLock();
  }
}

/**
 * Chạy 1 lần bằng tay trước khi deploy.
 */
function setupSystem() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ensureRegistrationSheet_(ss);
  SpreadsheetApp.flush();

  Logger.log('SETUP OK');
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('Sheet đang dùng: ' + sheet.getName());

  return {
    success: true,
    spreadsheetUrl: ss.getUrl(),
    sheetName: sheet.getName()
  };
}

/**
 * Test backend trực tiếp từ Apps Script.
 * Sẽ ghi 1 dòng TEST vào Sheet; có thể xóa sau khi kiểm tra.
 */
function testRegistration() {
  const result = submitRegistration({
    clientRequestId: 'manual-test-' + new Date().getTime(),
    source: 'MANUAL_TEST',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    pageUrl: CONFIG.FRONTEND_ORIGIN + '/dangkykhoahoc2026/',
    referrer: '',
    fullName: 'TEST BACKEND',
    phone: '0900000000',
    email: '',
    organization: 'BKCIT',
    province: 'Đồng Nai',
    aiLevel: 'Cơ bản',
    courseCode: 'K01',
    grade: '',
    guardianName: '',
    guardianPhone: '',
    learningGoal: 'Kiểm tra kết nối backend',
    privacyConsent: true,
    termsConsent: true,
    guardianConsent: false
  });

  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Chuẩn bị sheet mà không phá dữ liệu cũ.
 */
function ensureRegistrationSheet_(ss) {
  /**
   * Không xóa, không đổi tên, không ghi đè các sheet cũ.
   *
   * Thứ tự:
   * 1) Tìm DANG_KY nếu đúng schema -> dùng.
   * 2) Tìm DANG_KY_WEB nếu đúng schema -> dùng.
   * 3) Tìm DANG_KY_WEB_V2, V3... nếu có sheet đúng schema -> dùng.
   * 4) Nếu chưa có sheet tương thích -> tự tạo tên mới đầu tiên còn trống.
   *
   * Nhờ vậy setupSystem() không còn dừng chỉ vì các sheet cũ có cấu trúc khác.
   */
  const baseNames = [
    CONFIG.PRIMARY_SHEET,
    CONFIG.FALLBACK_SHEET
  ];

  // Kiểm tra hai tên chuẩn trước.
  for (let i = 0; i < baseNames.length; i++) {
    const sheet = ss.getSheetByName(baseNames[i]);

    if (!sheet) {
      const created = ss.insertSheet(baseNames[i]);
      prepareEmptySheet_(created);
      return created;
    }

    ensureColumns_(sheet);

    if (isSheetSchemaCompatible_(sheet)) {
      styleHeader_(sheet);
      return sheet;
    }

    // Nếu sheet hoàn toàn trống ở hàng tiêu đề thì có thể khởi tạo an toàn.
    if (isHeaderEmpty_(sheet)) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
      styleHeader_(sheet);
      return sheet;
    }
  }

  // Hai sheet chuẩn đều tồn tại nhưng không tương thích.
  // Tìm / tạo một sheet phiên bản mới mà không động tới dữ liệu cũ.
  for (let version = 2; version <= 100; version++) {
    const name = CONFIG.FALLBACK_SHEET + '_V' + version;
    const sheet = ss.getSheetByName(name);

    if (!sheet) {
      const created = ss.insertSheet(name);
      prepareEmptySheet_(created);
      Logger.log(
        'Đã tạo sheet mới vì schema cũ không tương thích: ' + name
      );
      return created;
    }

    ensureColumns_(sheet);

    if (isSheetSchemaCompatible_(sheet)) {
      styleHeader_(sheet);
      return sheet;
    }

    if (isHeaderEmpty_(sheet)) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
      styleHeader_(sheet);
      return sheet;
    }
  }

  throw new Error(
    'Không thể tìm hoặc tạo sheet dữ liệu tương thích sau 100 phiên bản. ' +
    'Vui lòng kiểm tra số lượng sheet trong Spreadsheet.'
  );
}

function isSheetSchemaCompatible_(sheet) {
  ensureColumns_(sheet);

  const header = sheet
    .getRange(1, 1, 1, HEADERS.length)
    .getDisplayValues()[0];

  return HEADERS.every(function(h, i) {
    return String(header[i] || '').trim() === h;
  });
}

function isHeaderEmpty_(sheet) {
  ensureColumns_(sheet);

  const header = sheet
    .getRange(1, 1, 1, HEADERS.length)
    .getDisplayValues()[0];

  return header.every(function(v) {
    return !String(v || '').trim();
  });
}

function prepareEmptySheet_(sheet) {
  ensureColumns_(sheet);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
  styleHeader_(sheet);
}

function ensureColumns_(sheet) {
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      HEADERS.length - sheet.getMaxColumns()
    );
  }
}

function styleHeader_(sheet) {
  const range = sheet.getRange(1, 1, 1, HEADERS.length);

  range
    .setFontWeight('bold')
    .setBackground('#07111f')
    .setFontColor('#ffffff')
    .setWrap(true);

  sheet.setFrozenRows(1);
}

function validatePayload_(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Dữ liệu đăng ký không hợp lệ.');
  }

  const fullName = safe_(data.fullName, 120);
  if (fullName.length < 2) {
    throw new Error('Họ và tên chưa hợp lệ.');
  }

  const phone = normalizePhone_(data.phone);
  if (!/^0\d{9}$/.test(phone)) {
    throw new Error('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.');
  }

  const course = COURSES[data.courseCode];
  if (!course) {
    throw new Error('Mã khóa học không hợp lệ.');
  }

  if (data.email) {
    const email = safe_(data.email, 160);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Email chưa đúng định dạng.');
    }
  }

  if (data.privacyConsent !== true || data.termsConsent !== true) {
    throw new Error('Chưa xác nhận đầy đủ điều khoản đăng ký.');
  }

  // Đối soát đúng validation của frontend cho K02.
  if (data.courseCode === 'K02') {
    if (!/^[6-9]$/.test(String(data.grade || ''))) {
      throw new Error('Khóa học sinh yêu cầu chọn lớp từ 6 đến 9.');
    }

    if (safe_(data.guardianName, 120).length < 2) {
      throw new Error('Thiếu họ tên phụ huynh/người giám hộ.');
    }

    if (!/^0\d{9}$/.test(normalizePhone_(data.guardianPhone))) {
      throw new Error('SĐT phụ huynh/người giám hộ chưa hợp lệ.');
    }

    if (data.guardianConsent !== true) {
      throw new Error('Thiếu xác nhận của phụ huynh/người giám hộ.');
    }
  }
}

function findExistingByRequestId_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // Cột C = Client Request ID.
  const match = sheet
    .getRange(2, 3, lastRow - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();

  if (!match) return null;

  const row = sheet
    .getRange(match.getRow(), 1, 1, HEADERS.length)
    .getValues()[0];

  const courseCode = String(row[15] || '');
  const course = COURSES[courseCode] || {};

  return {
    success: true,
    duplicate: true,
    registrationId: String(row[0] || ''),
    timestamp: row[1] instanceof Date
      ? Utilities.formatDate(
          row[1],
          CONFIG.TIME_ZONE,
          'dd/MM/yyyy HH:mm:ss'
        )
      : String(row[1] || ''),
    fullName: String(row[9] || ''),
    phone: String(row[10] || ''),
    courseCode: courseCode,
    courseName: String(row[16] || course.name || ''),
    totalFee: Number(row[17] || course.totalFee || 0),
    projectedTotal: Number(row[17] || course.totalFee || 0),
    sessions: Number(row[18] || course.sessions || 0),
    plannedSessions: Number(row[18] || course.sessions || 0),
    hoursPerSession: Number(row[19] || course.hoursPerSession || 0),
    totalHours: Number(row[20] || course.totalHours || 0),
    months: Number(row[21] || course.months || 0)
  };
}

function nextRegistrationId_(sheet, now) {
  const datePart = Utilities.formatDate(
    now,
    CONFIG.TIME_ZONE,
    'yyyyMMdd'
  );

  const prefix = CONFIG.REG_PREFIX + '-' + datePart + '-';
  const lastRow = sheet.getLastRow();
  let maxSeq = 0;

  if (lastRow >= 2) {
    const ids = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues();

    ids.forEach(function(row) {
      const id = String(row[0] || '');

      if (id.indexOf(prefix) === 0) {
        const seq = Number(id.slice(prefix.length));

        if (Number.isFinite(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    });
  }

  return prefix + String(maxSeq + 1).padStart(4, '0');
}

function normalizePhone_(value) {
  let phone = String(value || '').replace(/\D/g, '');

  if (phone.indexOf('84') === 0 && phone.length === 11) {
    phone = '0' + phone.slice(2);
  }

  return phone;
}

function safe_(value, maxLen) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maxLen || 500);
}

/**
 * Chỉ chấp nhận trang GitHub Pages đã cấu hình.
 * Loại bỏ query/hash để tạo callback ổn định.
 */
function allowedFrontendPage_(pageUrl) {
  try {
    const text = String(pageUrl || '');
    const m = text.match(/^(https:\/\/ducanhbkcit\.github\.io\/dangkykhoahoc2026\/?)/i);
    if (m) return CONFIG.FRONTEND_PAGE;
  } catch (err) {
    console.warn(err);
  }
  return CONFIG.FRONTEND_PAGE;
}

/**
 * Bridge ổn định cho GitHub Pages:
 * 1) Apps Script ghi dữ liệu xong.
 * 2) Trang phản hồi trong iframe điều hướng về GitHub Pages cùng origin với parent.
 * 3) index.html nhận __bkcit_bridge và postMessage lên parent.
 *
 * Cách này tránh phụ thuộc vào postMessage xuyên miền trực tiếp từ Apps Script.
 */
function responseBridge_(result, frontendPage) {
  const json = JSON.stringify(result);
  const token = Utilities.base64EncodeWebSafe(
    json,
    Utilities.Charset.UTF_8
  );

  const callback =
    String(frontendPage || CONFIG.FRONTEND_PAGE) +
    '?__bkcit_bridge=' +
    encodeURIComponent(token);

  const callbackJson = JSON.stringify(callback);

  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '</head><body>',
    '<script>',
    'window.location.replace(', callbackJson, ');',
    '<\/script>',
    '</body></html>'
  ].join('');

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
