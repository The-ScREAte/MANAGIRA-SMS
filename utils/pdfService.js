// One place for every PDF the app produces: report cards, transcripts and
// merit sheets, whether downloaded, posted to the portal, emailed, linked in
// WhatsApp/SMS/guardian notices or requested through Mira.
//
// Each PDF is rendered from the same page staff see, so the school's theme
// colours, font, logo and layout carry into the PDF unchanged. A single
// headless browser is kept warm and reused across requests (launching Chrome
// was most of the time spent per PDF) and closed after a few idle minutes to
// free memory. storePdf() uploads a PDF to S3 and returns its public link.

const puppeteer = require("puppeteer");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/s3");

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-web-security",
  "--font-render-hinting=none",
];
const BROWSER_IDLE_CLOSE_MS = 5 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 60000;
const ASSET_WAIT_TIMEOUT_MS = 10000;
const ASSET_POLL_INTERVAL_MS = 100;

// A4 at 96 dpi with 6 mm margins.
const PAGE_MARGIN_MM = 6;
const MM_TO_PX = 96 / 25.4;
const PRINTABLE_WIDTH_PX = (210 - PAGE_MARGIN_MM * 2) * MM_TO_PX;
const PRINTABLE_HEIGHT_PX = (297 - PAGE_MARGIN_MM * 2) * MM_TO_PX;
// Report cards are designed 800px wide; never shrink below this factor.
const MIN_REPORT_SCALE = 0.6;

// Errors whose message is safe and useful to show to staff.
function userFacingError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

let browserPromise = null;
let activePageCount = 0;
let idleCloseTimer = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.connected) return existing;
    } catch (_) {
      // Fall through and relaunch.
    }
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({ headless: true, args: BROWSER_ARGS });
  try {
    const browser = await browserPromise;
    browser.on("disconnected", () => {
      browserPromise = null;
    });
    return browser;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

function scheduleIdleClose() {
  clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(async () => {
    if (activePageCount > 0 || !browserPromise) return;
    const closing = browserPromise;
    browserPromise = null;
    try {
      const browser = await closing;
      await browser.close();
    } catch (_) {}
  }, BROWSER_IDLE_CLOSE_MS);
  if (typeof idleCloseTimer.unref === "function") idleCloseTimer.unref();
}

async function withPage(task) {
  clearTimeout(idleCloseTimer);
  activePageCount += 1;
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    return await task(page);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_) {}
    }
    activePageCount -= 1;
    if (activePageCount === 0) scheduleIdleClose();
  }
}

// Opens an app page as the signed-in user. Page scripts are disabled: the
// server-rendered HTML is complete, and scripts (menus, chat widget, SPA
// router) only slow rendering and can move things around.
async function openAppPage(page, { baseUrl, sessionCookie, path, mediaType, javaScript = false }) {
  if (!sessionCookie) {
    throw userFacingError("Session cookie missing. Refresh the page and try again.");
  }

  await page.setJavaScriptEnabled(javaScript);
  await page.setViewport({ width: 1024, height: 1400, deviceScaleFactor: 1 });
  await page.emulateMediaType(mediaType);
  // App pages drawn for a PDF are always in the white appearance.
  await page.setExtraHTTPHeaders({ 'X-Managira-Render': 'pdf' });
  await page.setCookie({ name: "connect.sid", value: sessionCookie, url: baseUrl });

  const response = await page.goto(`${baseUrl}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  const status = response ? response.status() : 0;
  const finalPath = new URL(page.url()).pathname;
  // Signed-out requests are redirected to the home page or the login page.
  if (finalPath === "/" || finalPath.startsWith("/account/login")) {
    throw userFacingError("Your session has expired. Please log in again and retry.");
  }
  if (status >= 400) {
    throw new Error(`Page returned HTTP ${status}.`);
  }
}

// Waits until web fonts and images are ready so the school's font, logo,
// watermark and signatures are in the PDF.
// Polled from Node: with page scripts disabled, page timers and event
// listeners do not run, so the page cannot signal readiness itself.
async function waitForAssets(page) {
  // Lazy images below the fold would otherwise never start loading.
  await page.evaluate(() => {
    Array.from(document.images).forEach((img) => {
      img.loading = "eager";
    });
  });

  const deadline = Date.now() + ASSET_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(
      () =>
        Array.from(document.images).every((img) => img.complete) &&
        (!document.fonts || document.fonts.status === "loaded")
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_INTERVAL_MS));
  }
}

// Screen styles are kept (they carry the school's design); this only removes
// on-screen card chrome and editing controls and lays one report per page.
const REPORT_PDF_CSS = `
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  #pdf-report-root { width: 800px; margin: 0 auto; }
  #pdf-report-root .student-report-grid { display: block !important; margin: 0 !important; padding: 0 !important; }
  #pdf-report-root .student-report {
    width: 800px !important;
    max-width: 800px !important;
    margin: 0 !important;
    box-shadow: none !important;
    transition: none !important;
    break-after: page;
    page-break-after: always;
  }
  #pdf-report-root .student-report-grid:last-child .student-report { break-after: auto; page-break-after: auto; }
  #pdf-report-root .pdf-hidden-report { display: none !important; }
  #pdf-report-root .student-checkbox,
  #pdf-report-root .paygira-edit-btn,
  #pdf-report-root .remark-arrow,
  #pdf-report-root .remark-dropdown,
  #pdf-report-root .promotion-chevron,
  #pdf-report-root button { display: none !important; }
  #pdf-report-root .pdf-field-text { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

// Moves the report cards into a clean body and turns form controls into
// plain text that keeps the control's on-screen font, colour and underline.
function isolateReportCards() {
  document
    .querySelectorAll("body style, body link[rel='stylesheet']")
    .forEach((node) => document.head.appendChild(node));

  const root = document.createElement("div");
  root.id = "pdf-report-root";
  document.querySelectorAll(".student-report-grid").forEach((grid) => root.appendChild(grid));
  document.body.replaceChildren(root);
  // The app layout reserves space for its fixed top bar on <body>.
  ["padding", "margin"].forEach((property) => {
    document.body.style.setProperty(property, "0", "important");
    document.documentElement.style.setProperty(property, "0", "important");
  });

  const toText = (control, text) => {
    const computed = window.getComputedStyle(control);
    const replacement = document.createElement(control.tagName === "TEXTAREA" ? "div" : "span");
    replacement.className = "pdf-field-text";
    replacement.textContent = text;
    [
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "lineHeight", "letterSpacing",
      "textAlign", "borderBottom", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    ].forEach((property) => {
      replacement.style[property] = computed[property];
    });
    if (control.tagName === "TEXTAREA") {
      replacement.style.display = "block";
      replacement.style.width = computed.width;
      replacement.style.minHeight = computed.height;
    }
    control.replaceWith(replacement);
  };

  root.querySelectorAll("textarea").forEach((control) => toText(control, control.value));
  root.querySelectorAll("select").forEach((control) => {
    const selected = control.options[control.selectedIndex];
    toText(control, selected ? selected.text : "");
  });
  root
    .querySelectorAll("input:not([type]), input[type='text'], input[type='number']")
    .forEach((control) => toText(control, control.value));

}

function measureReportCards() {
  return Array.from(document.querySelectorAll("#pdf-report-root .student-report")).map((report) => ({
    studentId: Number(report.getAttribute("data-student-id")),
    height: report.getBoundingClientRect().height,
  }));
}

function reportScaleFor(reportHeights) {
  const tallest = Math.max(...reportHeights, 1);
  const scale = Math.min(PRINTABLE_WIDTH_PX / 800, PRINTABLE_HEIGHT_PX / tallest, 1);
  return Math.max(Number(scale.toFixed(3)), MIN_REPORT_SCALE);
}

function pdfOptions(scale) {
  const margin = `${PAGE_MARGIN_MM}mm`;
  return {
    format: "A4",
    printBackground: true,
    scale,
    margin: { top: margin, right: margin, bottom: margin, left: margin },
  };
}

function buildReportPath({ classId, termId, studentIds }) {
  const params = new URLSearchParams({
    classId: String(classId),
    termId: String(termId),
    postingMode: "1",
  });
  if (Array.isArray(studentIds) && studentIds.length) {
    params.set("studentIds", studentIds.join(","));
  }
  return `/print/printStudentReport?${params.toString()}`;
}

async function loadReportCards(page, options) {
  await openAppPage(page, {
    baseUrl: options.baseUrl,
    sessionCookie: options.sessionCookie,
    path: buildReportPath(options),
    mediaType: "screen",
  });

  const reportCount = await page.$$eval(".student-report", (nodes) => nodes.length);
  if (!reportCount) {
    throw userFacingError("No report cards were found for the selected students.");
  }

  await page.addStyleTag({ content: REPORT_PDF_CSS });
  await page.evaluate(isolateReportCards);
  await waitForAssets(page);
  // Measured after images and fonts load, so the page-fit scale is right.
  return page.evaluate(measureReportCards);
}

// One PDF containing every selected student's report card, one per page.
async function renderReportCardsPdf({ baseUrl, sessionCookie, classId, termId, studentIds }) {
  return withPage(async (page) => {
    const reports = await loadReportCards(page, { baseUrl, sessionCookie, classId, termId, studentIds });
    const scale = reportScaleFor(reports.map((report) => report.height));
    const pdf = await page.pdf(pdfOptions(scale));
    return { buffer: Buffer.from(pdf), reportCount: reports.length };
  });
}

// A separate PDF per student, all rendered from one page load (the report
// page is computed once for the whole class instead of once per student).
// onReport(studentId, buffer) is awaited for each student in turn; a failure
// for one student is reported through onError and does not stop the rest.
async function renderReportCardsPerStudent(
  { baseUrl, sessionCookie, classId, termId, studentIds },
  { onReport, onError }
) {
  return withPage(async (page) => {
    const reports = await loadReportCards(page, { baseUrl, sessionCookie, classId, termId, studentIds });
    const renderedIds = new Set();

    for (const report of reports) {
      if (!Number.isFinite(report.studentId) || renderedIds.has(report.studentId)) continue;
      renderedIds.add(report.studentId);
      try {
        await page.evaluate((studentId) => {
          document.querySelectorAll("#pdf-report-root .student-report-grid").forEach((grid) => {
            const card = grid.querySelector(".student-report");
            const isTarget = card && Number(card.getAttribute("data-student-id")) === studentId;
            grid.classList.toggle("pdf-hidden-report", !isTarget);
            if (card) {
              card.style.breakAfter = isTarget ? "auto" : "";
              card.style.pageBreakAfter = isTarget ? "auto" : "";
            }
          });
        }, report.studentId);
        const pdf = await page.pdf(pdfOptions(reportScaleFor([report.height])));
        await onReport(report.studentId, Buffer.from(pdf));
      } catch (error) {
        if (onError) await onError(report.studentId, error);
        else throw error;
      }
    }

    const requested = Array.isArray(studentIds) ? studentIds.map(Number) : [];
    for (const studentId of requested) {
      if (!renderedIds.has(studentId) && onError) {
        await onError(studentId, userFacingError("Report card not found for this student in this class and term."));
      }
    }
  });
}

// Transcript, rendered from the transcript page itself so the school's theme
// colour and font match what staff see (its print styles already lay it out
// for paper). Unofficial copies carry the page's "UNOFFICIAL" watermark.
async function renderTranscriptPdf({ baseUrl, sessionCookie, studentId, official = true }) {
  const query = official ? "?official=true&pdf=true" : "";
  return withPage(async (page) => {
    await openAppPage(page, {
      baseUrl,
      sessionCookie,
      path: `/transcript/transcript/${encodeURIComponent(studentId)}${query}`,
      mediaType: "print",
    });
    const transcriptCount = await page.$$eval(".transcript", (nodes) => nodes.length);
    if (!transcriptCount) {
      throw userFacingError("The transcript could not be generated for this student.");
    }
    await waitForAssets(page);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
    });
    return Buffer.from(pdf);
  });
}

// Merit sheets use the page's own print styles on A4 landscape. A sheet too
// wide to read on one page is split into column groups, one per page: each
// page repeats the school header and the S/N, Student ID and Name columns,
// keeps every assessment next to its grade, and the last page carries
// Total, Average and Position. Nothing is ever cut off.
const MERIT_SHEET_MARGIN_MM = { top: 12, bottom: 12, left: 10, right: 10 };
const MERIT_SHEET_PRINTABLE_WIDTH_PX =
  (297 - MERIT_SHEET_MARGIN_MM.left - MERIT_SHEET_MARGIN_MM.right) * MM_TO_PX;
// Smallest scale for a sheet that fits on one page before it is split.
const MIN_SINGLE_PAGE_MERIT_SCALE = 0.6;
// Scale that split pages are laid out for.
const SPLIT_MERIT_SCALE = 0.75;

// Keeps only the sheet (the selection form above it would otherwise leave
// blank space) and adds the faint logo watermark that the page's
// before-print script adds in the browser.
function isolateMeritSheet() {
  document
    .querySelectorAll("body style, body link[rel='stylesheet']")
    .forEach((node) => document.head.appendChild(node));

  const section = document.querySelector(".print-section");
  const watermarkSource = document.querySelector(".merit-sheet-watermark-logo");
  document.body.replaceChildren(section);
  ["padding", "margin"].forEach((property) => {
    document.body.style.setProperty(property, "0", "important");
    document.documentElement.style.setProperty(property, "0", "important");
  });

  const logoUrl = watermarkSource && watermarkSource.getAttribute("src");
  if (logoUrl) {
    const watermark = document.createElement("div");
    watermark.id = "print-wm";
    watermark.setAttribute("aria-hidden", "true");
    const image = document.createElement("img");
    image.src = logoUrl;
    image.alt = "";
    image.style.cssText = "width:min(44vw,540px);opacity:0.08;object-fit:contain;";
    watermark.appendChild(image);
    document.body.appendChild(watermark);
  }
}

// Returns the widest table width after laying the sheet out, splitting it
// into column groups (one per page) when it is wider than maxSingleWidth.
// Header cells carry their role: data-merit-col="lead" (S/N, ID, name),
// "assessment" (a score and its grade share data-merit-group) or "summary"
// (Total, Average, Percentage, Position).
function layoutMeritSheetPages({ maxSingleWidth, splitWidth }) {
  const section = document.querySelector(".print-section");
  const header = section.querySelector(".header");
  const sheet = section.querySelector(".merit-sheet");
  const table = sheet.querySelector("table");
  const tableWidth = (element) =>
    Math.ceil(Math.max(element.scrollWidth, element.querySelector("table").scrollWidth));

  const fullWidth = tableWidth(sheet);
  const headerCells = Array.from(table.querySelectorAll("thead tr:first-child th"));
  const leading = [];
  const trailing = [];
  const groupsByKey = new Map();
  headerCells.forEach((cell, index) => {
    const role = cell.getAttribute("data-merit-col");
    if (role === "lead") leading.push(index);
    else if (role === "summary") trailing.push(index);
    else if (role === "assessment") {
      const key = cell.getAttribute("data-merit-group");
      if (!groupsByKey.has(key)) groupsByKey.set(key, []);
      groupsByKey.get(key).push(index);
    }
  });
  const units = Array.from(groupsByKey.values());
  if (fullWidth <= maxSingleWidth || units.length < 2) {
    return fullWidth;
  }

  const widthOf = (indexes) =>
    indexes.reduce((sum, index) => sum + headerCells[index].getBoundingClientRect().width, 0);

  // Greedy grouping of whole assessments into page-width column groups.
  // Each group is a list of units (an assessment with its grade/total).
  const flat = (group) => group.flat();
  const groups = [];
  let current = [];
  units.forEach((unit) => {
    if (current.length && widthOf(leading.concat(flat(current), unit)) > splitWidth) {
      groups.push(current);
      current = [unit];
    } else {
      current.push(unit);
    }
  });
  // The summary columns go on the last page. If they do not fit, move the
  // last assessments onto a final page with them rather than leaving a page
  // of totals only.
  if (trailing.length && widthOf(leading.concat(flat(current), trailing)) > splitWidth) {
    const carried = [];
    while (current.length > 1 && widthOf(leading.concat(flat(carried), trailing)) < splitWidth) {
      const moved = current.pop();
      if (widthOf(leading.concat(moved, flat(carried), trailing)) > splitWidth) {
        current.push(moved);
        break;
      }
      carried.unshift(moved);
    }
    groups.push(current);
    current = carried;
  }
  groups.push(current);
  const pageColumns = groups.map((group, index) =>
    index === groups.length - 1 ? flat(group).concat(trailing) : flat(group)
  );

  const keepColumns = (clonedTable, keep) => {
    const keepSet = new Set(keep);
    clonedTable.querySelectorAll("tr").forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (!keepSet.has(index)) cell.remove();
      });
    });
    Array.from(clonedTable.querySelectorAll("colgroup col")).forEach((col, index) => {
      if (!keepSet.has(index)) col.remove();
    });
  };

  const pages = pageColumns.map((group, pageIndex) => {
    const page = document.createElement("div");
    page.className = "merit-sheet-pdf-page";
    if (pageIndex > 0) page.style.breakBefore = "page";
    if (header) page.appendChild(header.cloneNode(true));
    const pageSheet = sheet.cloneNode(true);
    keepColumns(pageSheet.querySelector("table"), leading.concat(group));
    page.appendChild(pageSheet);
    return page;
  });

  const trailingNodes = Array.from(section.children).filter((node) => node !== header && node !== sheet);
  section.replaceChildren(...pages, ...trailingNodes);

  return Math.max(...Array.from(section.querySelectorAll(".merit-sheet")).map(tableWidth));
}

// columns: optional list of merit sheet column keys (see printController);
// omitted means the default layout.
async function renderMeritSheetPdf({ baseUrl, sessionCookie, classId, termId, subjectIds, assessmentIds, columns }) {
  // Comma-separated ids: the query parser caps repeated keys at 20 items.
  const params = new URLSearchParams({
    classId: String(classId),
    termId: String(termId),
    selectedSubjects: (subjectIds || []).join(","),
    selectedAssessments: (assessmentIds || []).join(","),
  });
  if (Array.isArray(columns)) {
    // "name" is always shown; it keeps the list non-empty when every
    // optional column is turned off.
    params.set("columns", ["name", ...columns].join(","));
  }
  return withPage(async (page) => {
    await openAppPage(page, {
      baseUrl,
      sessionCookie,
      path: `/print/generateMeritSheet?${params.toString()}`,
      mediaType: "print",
    });
    const tableCount = await page.$$eval(".print-section .merit-sheet table", (nodes) => nodes.length);
    if (!tableCount) {
      throw userFacingError("The merit sheet could not be generated for this selection.");
    }
    await page.evaluate(isolateMeritSheet);
    await waitForAssets(page);
    const contentWidth = await page.evaluate(layoutMeritSheetPages, {
      maxSingleWidth: MERIT_SHEET_PRINTABLE_WIDTH_PX / MIN_SINGLE_PAGE_MERIT_SCALE,
      splitWidth: MERIT_SHEET_PRINTABLE_WIDTH_PX / SPLIT_MERIT_SCALE,
    });
    const scale = Math.min(1, MERIT_SHEET_PRINTABLE_WIDTH_PX / Math.max(contentWidth, 1));
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      scale: Number(Math.max(scale, 0.1).toFixed(3)),
      margin: {
        top: `${MERIT_SHEET_MARGIN_MM.top}mm`,
        bottom: `${MERIT_SHEET_MARGIN_MM.bottom}mm`,
        left: `${MERIT_SHEET_MARGIN_MM.left}mm`,
        right: `${MERIT_SHEET_MARGIN_MM.right}mm`,
      },
    });
    return Buffer.from(pdf);
  });
}

// Organization stats: the page draws its charts with scripts, so scripts stay
// on here and the PDF waits for the page to report that every chart is drawn.
async function renderOrganizationStatsPdf({ baseUrl, sessionCookie, termId }) {
  return withPage(async (page) => {
    await openAppPage(page, {
      baseUrl,
      sessionCookie,
      path: `/stats/organization?selectedTermId=${encodeURIComponent(termId)}&pdf=true`,
      mediaType: "screen",
      javaScript: true,
    });
    try {
      await page.waitForFunction(() => window.__orgStatsReady === true, { timeout: NAVIGATION_TIMEOUT_MS });
    } catch (_) {
      throw userFacingError("The charts could not be drawn. Check the internet connection and try again.");
    }
    await waitForAssets(page);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
    return Buffer.from(pdf);
  });
}

// Any app page as a PDF, once the page sets window[readyFlag] = true
// (used by hub reports and the hub's school report).
async function renderAppPagePdf({ baseUrl, sessionCookie, path, readyFlag, landscape = false }) {
  return withPage(async (page) => {
    await openAppPage(page, { baseUrl, sessionCookie, path, mediaType: "screen", javaScript: true });
    if (readyFlag) {
      try {
        await page.waitForFunction((flag) => window[flag] === true, { timeout: NAVIGATION_TIMEOUT_MS }, readyFlag);
      } catch (_) {
        throw userFacingError("The report could not be drawn. Check the internet connection and try again.");
      }
    }
    await waitForAssets(page);
    const pdf = await page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
    return Buffer.from(pdf);
  });
}

function pdfPublicUrl(bucketName, key) {
  const regionName = String(process.env.AWS_REGION || "").trim();
  if (!regionName || regionName === "us-east-1") {
    return `https://${bucketName}.s3.amazonaws.com/${key}`;
  }
  return `https://${bucketName}.s3.${regionName}.amazonaws.com/${key}`;
}

// Uploads a generated PDF and returns its public link.
async function storePdf(key, buffer) {
  const bucketName = String(process.env.S3_BUCKET_NAME || process.env.S3_PUBLIC_BUCKET_NAME || "oneplaces3").trim();
  const cleanKey = String(key || "").replace(/^\/+/, "");
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
      Body: buffer,
      ContentType: "application/pdf",
    })
  );
  return pdfPublicUrl(bucketName, cleanKey);
}

// Safe file/key segment from a name, e.g. "Asare, Kojo" -> "Asare_Kojo".
function safeFileSegment(value, fallback) {
  return (
    String(value || "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

function sessionCookieFromHeader(cookieHeader) {
  const match = String(cookieHeader || "").match(/(?:^|;\s*)connect\.sid=([^;]+)/);
  return match ? match[1] : "";
}

module.exports = {
  withPage,
  renderReportCardsPdf,
  renderReportCardsPerStudent,
  renderTranscriptPdf,
  renderMeritSheetPdf,
  renderOrganizationStatsPdf,
  renderAppPagePdf,
  storePdf,
  safeFileSegment,
  sessionCookieFromHeader,
};
