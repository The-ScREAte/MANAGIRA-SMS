// Report card templates: a school's own Sheet or Doc laid out like its paper
// report card, with {{fields}} filled from the report data for each student.
// A class uses its assigned template; classes without one use the standard card.

let schemaReady = null;
function ensureReportTemplateSchema(db) {
  if (!schemaReady) {
    schemaReady = db.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS report_template BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS report_template_classes (
        class_id INTEGER PRIMARY KEY REFERENCES classes(class_id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS report_template_classes_doc_idx ON report_template_classes (document_id);
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// Fields a template can use, grouped for the field list in the editor.
const FIELD_GROUPS = [
  { group: 'School', fields: [
    ['school.name', 'School name'], ['school.motto', 'Motto'], ['school.address', 'Address'], ['school.phone', 'Phone'],
    ['school.email', 'Email'], ['school.website', 'Website'], ['school.region', 'Region / province'], ['school.country', 'Country'],
    ['school.logo', 'Logo (picture)'], ['school.logo:120', 'Logo, 120px tall'],
  ] },
  { group: 'Term', fields: [
    ['term.name', 'Term'], ['term.year', 'School year'], ['term.ends', 'Term ends (vacation date)'], ['term.next_begins', 'Next term begins (school reopens)'], ['report.date', 'Date printed'],
  ] },
  { group: 'Student', fields: [
    ['student.name', 'Full name'], ['student.first_name', 'First name'], ['student.last_name', 'Last name'], ['student.id', 'Student ID'],
    ['student.class', 'Class'], ['student.class_size', 'Number on roll'], ['student.photo', 'Photo (picture)'],
  ] },
  { group: 'Results', fields: [
    ['student.position', 'Position (e.g. 3rd)'], ['student.position_of', 'Position out of class size'], ['student.position_in_class', 'Position in class (e.g. 12th / 18 students)'],
    ['student.overall', 'Overall % | score (e.g. 78.00 % | 624.00 / 800.00)'], ['student.total_score', 'Total score'],
    ['student.total_max', 'Total possible'], ['student.average', 'Average %'], ['student.grade_total', 'Grade total (aggregate)'],
    ['student.promotion', 'Promoted / Repeated'], ['student.promoted_to', 'Promoted to (class)'],
  ] },
  { group: 'Attendance', fields: [['attendance.present', 'Days present'], ['attendance.total', 'Days school opened'], ['attendance.absent', 'Days absent']] },
  { group: 'Remarks', fields: [['remarks.teacher', "Teacher's remark"], ['remarks.conduct', 'Conduct'], ['remarks.attitude', 'Attitude'], ['remarks.interest', 'Interest']] },
  { group: 'Subjects (repeating row)', note: 'Put these in one row (or one line in a Doc). The row repeats for every subject.', fields: [
    ['subject.no', 'Row number'], ['subject.name', 'Subject'], ['subject.class_score', 'Class score'], ['subject.exam_score', 'Exam score'],
    ['subject.other_score', 'Other score'], ['subject.total', 'Total score'], ['subject.scaled', 'Scaled score'], ['subject.percentage', 'Percentage'],
    ['subject.grade', 'Grade'], ['subject.position', 'Position in subject'], ['subject.remark', 'Remark (e.g. Excellent)'],
    ['subject.mark:Excellent', '✓ when the remark or grade is Excellent'],
  ] },
  { group: 'Choice results', note: 'Assessments recorded as a choice (Yes / No, Pass / Fail …). Use the assessment’s name after the colon.', fields: [
    ['subject.choice:Practical', 'In the subject row: the choice for “Practical”'],
    ['subject[Mathematics].choice:Practical', 'Mathematics: the choice for “Practical”'],
    ['choices.all', 'Every choice result (e.g. Science – Practical: Yes · …)'],
  ] },
  { group: 'One subject', note: 'Use the subject’s name in brackets, e.g. a fixed row for Mathematics.', fields: [
    ['subject[Mathematics].total', 'Mathematics total'], ['subject[Mathematics].grade', 'Mathematics grade'], ['subject[Mathematics].mark:Very Good', '✓ when Mathematics is Very Good'],
  ] },
  { group: 'Fees', note: 'Filled when “Paygira bills” is on in Report settings.', fields: [
    ['fees.total_billed', 'Total billed'], ['fees.total_paid', 'Total paid'], ['fees.outstanding', 'Outstanding / arrears'], ['fees.credit_balance', 'Credit balance'], ['fees.last_payment_date', 'Last payment date'],
  ] },
  { group: 'Signature', fields: [['signature.image', 'Signature (picture)'], ['signature.name', 'Signed by'], ['signature.title', 'Title'], ['signature.image:80', 'Signature, 80px tall']] },
  { group: 'Grades', fields: [['grades.key', 'Interpretation of grades (e.g. A (90 to 100) = Excellent · …)']] },
  { group: 'Footer', note: 'Every printed card already ends with the school website (if any) and a Managira line.', fields: [['school.copyright', 'School name @year all rights reserved']] },
];

// The field list for a school: the fixed fields plus its own remark types.
function fieldGroupsFor(customRemarkTypes) {
  const custom = (customRemarkTypes || []).map((t) => [
    'remarks.' + String(t.type_key || '').replace(/^custom:/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    t.label || 'Custom remark',
  ]).filter((f) => f[0] !== 'remarks.');
  return FIELD_GROUPS.map((g) => (g.group === 'Remarks' ? Object.assign({}, g, { fields: g.fields.concat(custom) }) : g));
}

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SUBJECT_ROW = /\{\{\s*subject\.(?!\d)/;
const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v) => (v === null || v === undefined || v === '-' ? '' : String(v));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };

function subjectValue(subject, key, no) {
  if (!subject) return '';
  if (key.startsWith('choice:')) {
    const want = key.slice(7).trim().toLowerCase();
    const choices = subject.choices || {};
    const k = Object.keys(choices).find((title) => title.trim().toLowerCase() === want);
    return k ? clean(choices[k]) : '';
  }
  if (key.startsWith('mark:')) {
    const want = key.slice(5).trim().toLowerCase();
    const have = [subject.remarks, subject.grade, subject.gradeRaw].map((x) => clean(x).trim().toLowerCase());
    return want && have.includes(want) ? '✓' : '';
  }
  switch (key) {
    case 'no': return no;
    case 'name': return subject.subject_name;
    case 'class_score': return clean(subject.classAssessmentScore);
    case 'exam_score': return clean(subject.examsAssessmentScore);
    case 'other_score': return clean(subject.otherAssessmentScore);
    case 'total': return clean(subject.totalScore);
    case 'scaled': return clean(subject.scaledScore);
    case 'percentage': return clean(subject.totalPercentage);
    case 'grade': return clean(subject.grade);
    case 'position': return clean(subject.position);
    case 'remark': case 'remarks': return clean(subject.remarks);
    default: return '';
  }
}

// One field's value: text, or { img, size } for pictures.
function resolveField(token, ctx, student, subject, subjectNo) {
  const t = token.trim();
  const [path, arg] = (() => { const i = t.indexOf(':'); return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; })();
  const named = t.match(/^subject\[(.+?)\]\.(.+)$/i);
  if (named) {
    const want = named[1].trim().toLowerCase();
    const sub = (student.subjects || []).find((s) => String(s.subject_name || '').trim().toLowerCase() === want);
    return subjectValue(sub, named[2].trim(), '');
  }
  const indexed = t.match(/^subject\.(\d+)\.(.+)$/i);
  if (indexed) {
    const i = Number(indexed[1]);
    return subjectValue((student.subjects || [])[i - 1], indexed[2].trim(), i);
  }
  if (path.startsWith('subject.')) return subjectValue(subject, t.slice(8), subjectNo);

  const r = ctx.locals;
  const att = student.attendance || {};
  const present = student.manualAttendancePresentDays !== null && student.manualAttendancePresentDays !== undefined ? student.manualAttendancePresentDays : att.presentDays;
  const total = student.manualAttendanceTotalDays || att.totalDays;
  const remarkFrom = (key) => {
    const custom = student.customRemarks || {};
    const k = Object.keys(custom).find((x) => slug(x) === slug(key));
    return k ? clean(custom[k]) : '';
  };
  switch (path) {
    case 'school.name': return r.orgName;
    case 'school.motto': return ctx.motto;
    case 'school.address': return r.orgAddress;
    case 'school.phone': return r.orgPhone;
    case 'school.email': return r.email;
    case 'school.website': return r.schoolWebsiteHost;
    case 'school.region': return r.orgProvince;
    case 'school.country': return r.orgCountry;
    case 'school.logo': { const logo = ctx.logo || r.logoUrl; return logo ? { img: logo, size: Number(arg) || 80 } : ''; }
    case 'school.copyright': return (r.orgName || '') + ' @' + (r.reportYear || new Date().getFullYear()) + ' all rights reserved';
    case 'term.name': return r.term && r.term.term_name;
    case 'term.year': return r.schoolYearLabel;
    case 'term.ends': return ctx.date(r.termEndDate);
    case 'term.next_begins': return ctx.date(r.schoolReopenDate);
    case 'report.date': return ctx.date(new Date());
    case 'student.name': return student.display_name || [student.first_name, student.last_name].filter(Boolean).join(' ');
    case 'student.first_name': return student.first_name;
    case 'student.last_name': return student.last_name;
    case 'student.id': return student.display_student_id || student.custom_student_id;
    case 'student.class': return student.class_name || ctx.className;
    case 'student.class_size': return ctx.classSize;
    case 'student.photo': return { img: student.image_url && student.image_url !== 'profilePlaceholder.png' ? student.image_url : '/images/profilePlaceholder.png', size: Number(arg) || 90 };
    case 'student.position_in_class': return clean(student.positionInClass);
    case 'student.overall': {
      const pct = student.overallPercentage ? student.overallPercentage + ' %' : '';
      const sc = Number(student.totalScoreSum || 0) ? Number(student.totalScoreSum).toFixed(2) + (student.totalMaxScoreSum ? ' / ' + Number(student.totalMaxScoreSum).toFixed(2) : '') : '';
      return [pct, sc].filter(Boolean).join(' | ');
    }
    case 'student.position': return student.class_position ? ordinal(student.class_position) : '';
    case 'student.position_of': return student.class_position ? ordinal(student.class_position) + ' out of ' + ctx.classSize : '';
    case 'student.total_score': return Number(student.totalScoreSum || 0) ? Number(student.totalScoreSum).toFixed(2) : '';
    case 'student.total_max': return clean(student.totalMaxScoreSum);
    case 'student.average': return student.overallPercentage ? student.overallPercentage + '%' : '';
    case 'student.grade_total': return Number.isFinite(Number(student.totalGradeNumericScore)) ? Number(student.totalGradeNumericScore) : '';
    case 'student.promotion': return r.activatePromotion ? clean(student.promotionStatus) : '';
    case 'student.promoted_to': return r.activatePromotion ? clean(student.promotionClass) : '';
    case 'attendance.present': return clean(present);
    case 'attendance.total': return clean(total);
    case 'attendance.absent': return Number.isFinite(Number(total)) && Number.isFinite(Number(present)) && total ? Number(total) - Number(present) : '';
    case 'remarks.teacher': case 'remarks.conduct': case 'remarks.attitude': case 'remarks.interest':
      if (ctx.remarkField) return { html: ctx.remarkField(path.slice(8), student) };
      return student[path.slice(8) + 'Remarks'];
    case 'signature.image': return r.signatureImageUrl ? { img: r.signatureImageUrl, size: Number(arg) || 50 } : '';
    case 'grades.key': {
      const list = (r.scoreRemarks || []).slice().sort((a, b) => Number(b.toPercentage || b.to_percentage || 0) - Number(a.toPercentage || a.to_percentage || 0));
      return list.map((x) => (x.gradeLabel || '-') + ' (' + (x.fromPercentage ?? x.from_percentage) + ' to ' + (x.toPercentage ?? x.to_percentage) + ') = ' + (x.remark || '-')).join('  ·  ');
    }
    case 'choices.all':
      return (student.choiceResults || []).map((x) => x.subject + ' – ' + x.title + ': ' + x.choice).join('  ·  ');
    case 'signature.name': return r.signatureName;
    case 'signature.title': return r.signatureTitle;
    default:
      if (path.startsWith('remarks.')) return ctx.remarkField ? { html: ctx.remarkField(path.slice(8), student) } : remarkFrom(path.slice(8));
      if (path.startsWith('fees.')) {
        const want = slug(path.slice(5));
        const row = (student.paygiraAutoRows || []).find((x) => slug(x.label) === want || (want === 'outstanding' && slug(x.label) === 'outstanding'));
        return row ? row.value : '';
      }
      return '';
  }
}

const objHtml = (v) => (v.html !== undefined ? v.html : imgHtml(v));
const imgHtml = (v) => '<img src="' + esc(v.img) + '" alt="" onerror="this.remove()" style="max-height:' + v.size + 'px;max-width:100%;object-fit:contain;vertical-align:middle">';

// Replace every {{field}} in plain text (sheet cells): returns HTML.
function fillText(text, ctx, student, subject, no) {
  const raw = String(text || '');
  const only = raw.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (only) {
    const v = resolveField(only[1], ctx, student, subject, no);
    return v && typeof v === 'object' ? objHtml(v) : esc(v);
  }
  let out = '', last = 0;
  raw.replace(TOKEN, (m, key, at) => {
    out += esc(raw.slice(last, at));
    const v = resolveField(key, ctx, student, subject, no);
    out += v && typeof v === 'object' ? objHtml(v) : esc(v);
    last = at + m.length;
    return m;
  });
  return out + esc(raw.slice(last));
}

// Replace {{fields}} inside Doc HTML (text there is already HTML-escaped).
function fillHtml(html, ctx, student, subject, no) {
  return String(html || '').replace(TOKEN, (m, key) => {
    const v = resolveField(key.replace(/&amp;/g, '&').replace(/<[^>]+>/g, ''), ctx, student, subject, no);
    return v && typeof v === 'object' ? objHtml(v) : esc(v);
  });
}

function parseCell(id) {
  const m = String(id).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}
const colLabel = (n) => { let s = ''; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; };

function cellCss(st) {
  const s = st || {};
  const line = '1px solid currentColor';
  const bd = s.bd || '';
  const light = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170; };
  return [
    s.bg && !s.color && light(s.bg) ? 'color:#111827' : '',
    s.b ? 'font-weight:700' : '', s.i ? 'font-style:italic' : '', s.u ? 'text-decoration:underline' : '',
    s.color ? 'color:' + s.color : '', s.bg ? 'background:' + s.bg : '', s.align ? 'text-align:' + s.align : '',
    s.fs ? 'font-size:' + Number(s.fs) + 'px' : '',
    bd.includes('t') ? 'border-top:' + line : '', bd.includes('b') ? 'border-bottom:' + line : '',
    bd.includes('l') ? 'border-left:' + line : '', bd.includes('r') ? 'border-right:' + line : '',
  ].filter(Boolean).join(';');
}

// Sheet template -> one student's report card as an HTML table.
function renderSheet(sheet, ctx, student) {
  const cells = sheet.cells || {}, styles = sheet.styles || {}, merges = sheet.merges || [];
  const hiddenRows = new Set(sheet.hiddenRows || []), hiddenCols = new Set(sheet.hiddenCols || []);
  let rows = 0, cols = 0;
  const grow = (id) => { const p = parseCell(id); if (p) { rows = Math.max(rows, p.r + 1); cols = Math.max(cols, p.c + 1); } };
  Object.keys(cells).forEach((k) => { if (cells[k] !== '' && cells[k] != null) grow(k); });
  Object.keys(styles).forEach((k) => { if (styles[k] && (styles[k].bg || styles[k].bd)) grow(k); });
  merges.forEach((m) => { rows = Math.max(rows, m.r + m.rs); cols = Math.max(cols, m.c + m.cs); });
  if (!rows || !cols) return '<p style="padding:24px;color:#64748b">This template is empty.</p>';

  const visibleCols = [];
  for (let c = 0; c < cols; c++) if (!hiddenCols.has(c)) visibleCols.push(c);
  const widthOf = (c) => (sheet.colWidths && sheet.colWidths[c]) || Number((sheet.settings || {}).colWidth) || 120;
  const totalW = visibleCols.reduce((a, c) => a + widthOf(c), 0);
  const covered = new Set(), anchor = new Map();
  merges.forEach((m) => {
    anchor.set(m.r + ':' + m.c, m);
    for (let i = m.r; i < m.r + m.rs; i++) for (let j = m.c; j < m.c + m.cs; j++) if (i !== m.r || j !== m.c) covered.add(i + ':' + j);
  });

  let html = '<table class="rt-sheet"><colgroup>' + visibleCols.map((c) => '<col style="width:' + (100 * widthOf(c) / totalW).toFixed(3) + '%">').join('') + '</colgroup><tbody>';
  const subjects = student.subjects || [];
  for (let r = 0; r < rows; r++) {
    if (hiddenRows.has(r)) continue;
    let rowText = '';
    for (let c = 0; c < cols; c++) rowText += String(cells[colLabel(c) + (r + 1)] || '');
    const repeat = SUBJECT_ROW.test(rowText);
    const copies = repeat ? subjects.map((s, i) => [s, i + 1]) : [[null, '']];
    copies.forEach(([subject, no]) => {
      html += '<tr>';
      visibleCols.forEach((c) => {
        if (covered.has(r + ':' + c)) return;
        const id = colLabel(c) + (r + 1);
        const m = anchor.get(r + ':' + c);
        const span = m ? (m.cs > 1 ? ' colspan="' + m.cs + '"' : '') + (m.rs > 1 && !repeat ? ' rowspan="' + m.rs + '"' : '') : '';
        const raw = cells[id];
        const text = typeof raw === 'string' && raw.startsWith('=') ? '' : raw;
        html += '<td' + span + ' style="' + cellCss(styles[id]) + '">' + fillText(text, ctx, student, subject, no) + '</td>';
      });
      html += '</tr>';
    });
  }
  return html + '</tbody></table>';
}

// Doc template -> HTML. Lines with subject fields repeat for every subject.
function renderDoc(doc, ctx, student) {
  let html = doc.html;
  if (!html) {
    const text = (doc.ops || []).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
    html = text.split('\n').map((line) => '<p>' + esc(line) + '</p>').join('');
  }
  const subjects = student.subjects || [];
  html = html.replace(/<(p|li|h[1-6]|blockquote|pre)(\s[^>]*)?>[\s\S]*?<\/\1>/g, (block) => {
    if (!SUBJECT_ROW.test(block.replace(/<[^>]+>/g, ''))) return block;
    return subjects.map((s, i) => fillHtml(block, ctx, student, s, i + 1)).join('');
  });
  const settings = doc.settings || {};
  return '<div class="rt-doc ql-editor" style="line-height:' + (Number(settings.spacing) || 1.6) + ';font-size:' + (Number(settings.size) || 15) + 'px">' + fillHtml(html, ctx, student, null, '') + '</div>';
}

function renderTemplate(document, ctx, student) {
  let content = {};
  try { content = JSON.parse(document.content || '{}') || {}; } catch (e) { content = { html: String(document.content || '') }; }
  return document.doc_type === 'spreadsheet' ? renderSheet(content, ctx, student) : renderDoc(content, ctx, student);
}

async function templateForClass(db, orgId, classId) {
  await ensureReportTemplateSchema(db);
  const { rows } = await db.query(`
    SELECT d.id, d.title, d.doc_type, d.content
    FROM report_template_classes rtc
    JOIN documents d ON d.id = rtc.document_id AND d.organization_id = rtc.organization_id
    WHERE rtc.organization_id = $1 AND rtc.class_id = $2 AND d.is_deleted = FALSE AND d.report_template = TRUE
  `, [orgId, classId]);
  return rows[0] || null;
}

// Any of the school's Docs / Sheets, for previewing it as a report card.
async function templateById(db, orgId, documentId) {
  await ensureReportTemplateSchema(db);
  const { rows } = await db.query(
    'SELECT id, title, doc_type, content FROM documents WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE',
    [documentId, orgId]
  );
  return rows[0] || null;
}

// ---- Excel (.xlsx) import: values, merges, fonts, fills, borders, widths ----
function argbToHex(argb) {
  if (!argb || typeof argb !== 'string') return '';
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : '';
}
async function importXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.state !== 'hidden') || wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('This file has no sheets.'), { status: 400 });
  const maxRows = Math.min(ws.rowCount || 0, 600), maxCols = Math.min(ws.columnCount || 0, 80);
  const cells = {}, styles = {}, colWidths = {}, merges = [];
  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCols; c++) {
      const cell = row.getCell(c);
      const id = colLabel(c - 1) + r;
      let v = cell.value;
      if (v && typeof v === 'object') {
        if (v.richText) v = v.richText.map((t) => t.text).join('');
        else if (v.formula || v.sharedFormula) v = v.result !== undefined && v.result !== null ? v.result : '';
        else if (v.text) v = v.text;
        else if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else if (v.hyperlink) v = v.text || v.hyperlink;
        else v = '';
      }
      if (v !== null && v !== undefined && v !== '') cells[id] = String(v);
      const st = {};
      const f = cell.font || {};
      if (f.bold) st.b = 1;
      if (f.italic) st.i = 1;
      if (f.underline) st.u = 1;
      if (f.size && Math.round(f.size) !== 11) st.fs = Math.round(f.size * 1.33);
      const color = argbToHex(f.color && f.color.argb);
      if (color && color !== '#000000') st.color = color;
      const fill = cell.fill || {};
      const bg = fill.type === 'pattern' && fill.pattern !== 'none' ? argbToHex(fill.fgColor && fill.fgColor.argb) : '';
      if (bg && bg !== '#ffffff') st.bg = bg;
      const al = cell.alignment && cell.alignment.horizontal;
      if (al === 'center' || al === 'centerContinuous') st.align = 'center';
      else if (al === 'right') st.align = 'right';
      const b = cell.border || {};
      const bd = (b.top && b.top.style ? 't' : '') + (b.bottom && b.bottom.style ? 'b' : '') + (b.left && b.left.style ? 'l' : '') + (b.right && b.right.style ? 'r' : '');
      if (bd) st.bd = bd;
      if (Object.keys(st).length) styles[id] = st;
    }
  }
  for (let c = 1; c <= maxCols; c++) {
    const w = ws.getColumn(c).width;
    if (w) colWidths[c - 1] = Math.max(30, Math.min(600, Math.round(w * 7 + 5)));
  }
  const rangeList = (ws.model && ws.model.merges) || [];
  rangeList.forEach((ref) => {
    const [a, b] = String(ref).split(':');
    const p = parseCell(a), q = parseCell(b || a);
    if (p && q && p.r < maxRows && p.c < maxCols) merges.push({ r: p.r, c: p.c, rs: q.r - p.r + 1, cs: q.c - p.c + 1 });
  });
  return { cells, styles, colWidths, merges, rowCount: Math.max(maxRows + 5, 20), colCount: Math.max(maxCols, 10), name: ws.name };
}

module.exports = { ensureReportTemplateSchema, FIELD_GROUPS, fieldGroupsFor, renderTemplate, templateForClass, templateById, importXlsx };
