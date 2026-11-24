const test = require("node:test");
const assert = require("node:assert");
const imp = require("../utils/studentImportFields");
const fieldsLib = require("../utils/studentFormFields");
const { studentImportPipeline: pipe } = require("../controllers/commonController");

let nextId = 1;
const F = (label, type = "text", extra = {}) => ({ id: nextId++, label, type, options: [], required: false, status: "active", onStudentForm: true, ...extra });
const HEAD = ["First Name", "Last Name", "Date of Birth", "Gender", "Class"];
const parse = (headers, rows, fields, report) => pipe.parseRowsToStudents(headers, rows, fields, report);
const std = (...extra) => ["Ama", "Mensah", "2012-05-15", "Female", "Class 1", ...extra];

// ---------- headers ----------

test("headers match whatever the case, spacing, punctuation, accents or trailing marks", () => {
  const f = F("Blood Group");
  for (const h of ["blood group", "BLOOD  GROUP", "Blood-Group", "blood_group:", "Blood Group *", "Blood Group (required)", "  Blood Group  ", "BLOOD GROUP*", "Blóod Gróup"]) {
    const m = imp.mapCustomColumns([h], [f]);
    assert.strictEqual(m.columns.length, 1, `"${h}" should match`);
  }
  const accent = F("Número de pasaporte");
  assert.strictEqual(imp.mapCustomColumns(["numero de pasaporte"], [accent]).columns.length, 1);
  assert.strictEqual(imp.mapCustomColumns(["Número De Pasaporte*"], [accent]).columns.length, 1);
});

test("headers that match nothing are listed, never fatal", () => {
  const m = imp.mapCustomColumns(["Shoe size", "", null, undefined, 5, { richText: [{ text: "Hobby" }] }], [F("Hobby")]);
  assert.strictEqual(m.columns.length, 1);
  assert.deepStrictEqual(m.unmatched.map((u) => u.header), ["Shoe size", "5"]);
});

test("a duplicate header fills once; the repeat is reported", () => {
  const f = F("Hobby");
  const m = imp.mapCustomColumns(["Hobby", "hobby"], [f]);
  assert.strictEqual(m.columns.length, 1);
  assert.strictEqual(m.columns[0].index, 0);
  assert.deepStrictEqual(m.unmatched, [{ index: 1, header: "hobby", reason: "duplicate" }]);
});

test("two fields whose labels read the same take the columns in order", () => {
  const a = F("Blood type"); const b = F("Blood-type");
  let m = imp.mapCustomColumns(["Blood type", "blood type"], [a, b]);
  assert.deepStrictEqual(m.columns.map((c) => c.field.id), [a.id, b.id]);
  m = imp.mapCustomColumns(["Blood type"], [a, b]);
  assert.strictEqual(m.columns.length, 1);
  assert.deepStrictEqual(m.ambiguous, ["Blood-type"]);
});

test("unicode, emoji and symbol-only labels still match", () => {
  const f = [F("Façon"), F("🍕 Favourite"), F("家庭言語"), F("???"), F("الجنسية")];
  const m = imp.mapCustomColumns(["FACON", "🍕 favourite", "家庭言語 *", "???", "الجنسية"], f);
  assert.strictEqual(m.columns.length, 5);
});

test("obsolete and application-only fields are ignored", () => {
  const live = F("Live");
  const old = F("Old", "text", { status: "obsolete" });
  const appOnly = F("Apply", "text", { onStudentForm: false });
  const m = imp.mapCustomColumns(["Live", "Old", "Apply"], [live, old, appOnly]);
  assert.deepStrictEqual(m.columns.map((c) => c.field.label), ["Live"]);
  assert.deepStrictEqual(m.unmatched.map((u) => u.header), ["Old", "Apply"]);
});

test("200 custom columns and 60 fields map fast", () => {
  const fields = Array.from({ length: 60 }, (_, i) => F(`Field ${i}`));
  const headers = Array.from({ length: 200 }, (_, i) => `Field ${i}`);
  const t = Date.now();
  const m = imp.mapCustomColumns(headers, fields);
  assert.strictEqual(m.columns.length, 60);
  assert.strictEqual(m.unmatched.length, 140);
  assert.ok(Date.now() - t < 200);
});

// ---------- cells ----------

test("rich text, formula, hyperlink and error cells become plain text", () => {
  assert.strictEqual(imp.cellText({ richText: [{ text: "Hel" }, { text: "lo" }] }), "Hello");
  assert.strictEqual(imp.cellText({ formula: "A1&B1", result: "AB" }), "AB");
  assert.strictEqual(imp.cellText({ formula: "1+1", result: 2 }), "2");
  assert.strictEqual(imp.cellText({ sharedFormula: "A1", result: "x" }), "x");
  assert.strictEqual(imp.cellText({ formula: "A1" }), "");
  assert.strictEqual(imp.cellText({ error: "#N/A" }), "");
  assert.strictEqual(imp.cellText({ formula: "A1", result: { error: "#DIV/0!" } }), "");
  assert.strictEqual(imp.cellText({ text: "Site", hyperlink: "https://x.test" }), "Site");
  assert.strictEqual(imp.cellText({ text: { richText: [{ text: "R" }] }, hyperlink: "https://x.test" }), "R");
  assert.strictEqual(imp.cellText({ hyperlink: "mailto:a@b.test" }), "a@b.test");
  assert.strictEqual(imp.cellText({ weird: 1 }), "");
  assert.strictEqual(imp.cellText(new Date("garbage")), "");
  assert.strictEqual(imp.cellText(new Date(Date.UTC(2012, 4, 5))), "2012-05-05");
  assert.strictEqual(imp.cellText(true), "true");
  assert.strictEqual(imp.cellText(1e21), "1000000000000000000000");
  assert.ok(!/object/.test(imp.cellText({ a: { b: 1 } })));
  const circular = {}; circular.value = circular;
  assert.strictEqual(imp.cellText(circular), "");
});

test("numbers: separators, decimals, exponent, odd digits and rejects", () => {
  const n = (v) => imp.parseNumber(v);
  assert.deepStrictEqual(n("1,200"), { value: "1200" });
  assert.deepStrictEqual(n("1 200"), { value: "1200" });
  assert.deepStrictEqual(n("1 200"), { value: "1200" });
  assert.deepStrictEqual(n("1,234,567.5"), { value: "1234567.5" });
  assert.deepStrictEqual(n("12.5"), { value: "12.5" });
  assert.deepStrictEqual(n("12,5"), { value: "12.5" });
  assert.deepStrictEqual(n("1.234,5"), { value: "1234.5" });
  assert.deepStrictEqual(n("-7"), { value: "-7" });
  assert.deepStrictEqual(n("−7"), { value: "-7" });
  assert.deepStrictEqual(n("+7"), { value: "7" });
  assert.deepStrictEqual(n(".5"), { value: "0.5" });
  assert.deepStrictEqual(n("5."), { value: "5" });
  assert.deepStrictEqual(n("1e3"), { value: "1000" });
  assert.deepStrictEqual(n("٣"), { value: "3" });
  assert.deepStrictEqual(n("۱۲"), { value: "12" });
  assert.deepStrictEqual(n(42), { value: "42" });
  assert.deepStrictEqual(n(0.1 + 0.2).value.startsWith("0.3"), true);
  assert.deepStrictEqual(n({ formula: "1+1", result: 2 }), { value: "2" });
  assert.deepStrictEqual(n(""), { value: "" });
  assert.deepStrictEqual(n(null), { value: "" });
  for (const bad of ["abc", "12abc", "1e999", "NaN", "Infinity", "1..2", "--1", "$5", "1,2,3", true, new Date(), "9".repeat(60), NaN]) {
    assert.strictEqual(imp.parseNumber(bad).issue, "number", `${String(bad)} should be refused`);
    assert.strictEqual(imp.parseNumber(bad).value, "");
  }
});

test("dates: ISO, day-first, month-first, ambiguous, serial, Date, text and garbage", () => {
  const d = (v, o) => imp.parseDate(v, o);
  assert.deepStrictEqual(d("2012-12-31"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("2012/1/5"), { value: "2012-01-05" });
  assert.deepStrictEqual(d("2012-12-31T10:00:00Z"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("20121231"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("31/12/2012"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("12/31/2012"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("31.12.2012"), { value: "2012-12-31" });
  assert.deepStrictEqual(d("05/06/2012"), { value: "2012-05-06" }, "month first, like the date of birth import");
  assert.deepStrictEqual(d("05/06/2012", "dmy"), { value: "2012-06-05" });
  assert.deepStrictEqual(d(41000), { value: "2012-04-01" });
  assert.deepStrictEqual(d("41000"), { value: "2012-04-01" });
  assert.deepStrictEqual(d(41000.75), { value: "2012-04-01" });
  assert.deepStrictEqual(d(new Date(Date.UTC(2012, 3, 1))), { value: "2012-04-01" });
  assert.deepStrictEqual(d({ formula: "A1", result: new Date(Date.UTC(2012, 3, 1)) }), { value: "2012-04-01" });
  assert.deepStrictEqual(d("5 Mar 2012"), { value: "2012-03-05" });
  assert.deepStrictEqual(d("March 5th, 2012"), { value: "2012-03-05" });
  assert.deepStrictEqual(d("٢٠١٢-٠٥-٠٥"), { value: "2012-05-05" });
  assert.deepStrictEqual(d(""), { value: "" });
  for (const bad of ["garbage", "32/01/2012", "30/02/2012", "2012-13-01", "0000-00-00", "12/12/12", "2012", "99999999", 12, 99999999, true, "1/1/1800", "2012-02-30"]) {
    assert.strictEqual(d(bad).issue, "date", `${String(bad)} should be refused`);
    assert.strictEqual(d(bad).value, "");
  }
  assert.deepStrictEqual(d("29/02/2012"), { value: "2012-02-29" }, "a real leap day");
  assert.strictEqual(d("29/02/2013").issue, "date");
});

test("a date column reads day-first or month-first from its own rows", () => {
  assert.strictEqual(imp.inferDateOrder(["31/12/2012", "05/06/2012"]), "dmy");
  assert.strictEqual(imp.inferDateOrder(["12/31/2012", "05/06/2012"]), "mdy");
  assert.strictEqual(imp.inferDateOrder(["05/06/2012"]), "mdy");
  assert.strictEqual(imp.inferDateOrder([]), "mdy");
  assert.strictEqual(imp.inferDateOrder([null, 5, {}, "x"]), "mdy");
  const f = F("Joined", "date");
  const students = parse([...HEAD, "Joined"], [std("31/12/2012"), std("05/06/2012")], [f]);
  assert.deepStrictEqual(students.map((s) => s.custom[f.id]), ["2012-12-31", "2012-06-05"]);
});

test("choices: any case and spacing match; others are kept and flagged", () => {
  const f = F("House", "choice", { options: ["Red", "Blue Team", "Green"] });
  const c = (v) => imp.parseChoice(f, v);
  assert.deepStrictEqual(c("red"), { value: "Red" });
  assert.deepStrictEqual(c("  BLUE   team "), { value: "Blue Team" });
  assert.deepStrictEqual(c("blue-team"), { value: "Blue Team" });
  assert.deepStrictEqual(c("Purple"), { value: "Purple", issue: "choice" });
  assert.deepStrictEqual(c(""), { value: "" });
  assert.deepStrictEqual(c({ richText: [{ text: "gre" }, { text: "en" }] }), { value: "Green" });
  assert.strictEqual(c("x".repeat(900)).value.length, 500);
});

test("yes / no variants", () => {
  for (const v of ["yes", "Yes", " YES ", "y", "Y", "true", "TRUE", "1", 1, true, "Yes."]) assert.strictEqual(imp.parseYesNo(v).value, "yes", String(v));
  for (const v of ["no", "No", "n", "N", "false", "FALSE", "0", 0, false]) assert.strictEqual(imp.parseYesNo(v).value, "no", String(v));
  for (const v of ["maybe", "2", "yess", "nope!!!x"]) assert.strictEqual(imp.parseYesNo(v).issue, "yes/no", String(v));
  assert.deepStrictEqual(imp.parseYesNo(""), { value: "" });
});

test("long text is cut and flagged, short text is tidied", () => {
  const long = imp.parseText({ type: "long_text" }, "a".repeat(4500));
  assert.strictEqual(long.value.length, 4000);
  assert.strictEqual(long.issue, "long");
  const short = imp.parseText({ type: "text" }, "b".repeat(700));
  assert.strictEqual(short.value.length, 500);
  assert.strictEqual(short.issue, "long");
  assert.deepStrictEqual(imp.parseText({ type: "text" }, "  a \n  b\t c "), { value: "a b c" });
  assert.deepStrictEqual(imp.parseText({ type: "long_text" }, "line1\r\nline2\n\n\n\nline3"), { value: "line1\nline2\n\nline3" });
  assert.deepStrictEqual(imp.parseText({ type: "text" }, "a\u0000b​c"), { value: "abc" });
});

test("formula-looking text stays plain text and is quoted again on export", () => {
  const f = F("Note");
  const evil = ["=cmd|' /C calc'!A0", "+SUM(A1)", "-2+3", "@SUM(1)", "=HYPERLINK(\"http://x\")"];
  const out = parse([...HEAD, "Note"], evil.map((e) => std(e)), [f]);
  assert.deepStrictEqual(out.map((s) => s.custom[f.id]), evil);
  assert.ok(out.every((s) => s.customIssues.length === 0));
  evil.forEach((e) => assert.strictEqual(imp.csvSafe(e), `'${e}`));
  assert.strictEqual(imp.csvSafe("fine"), "fine");
  const csv = imp.toCsv([["a", evil[0]]]);
  assert.ok(csv.includes(`'=cmd`));
  assert.ok(!/(^|,)=cmd/.test(csv.replace("﻿", "")));
});

// ---------- whole files ----------

test("a row's custom cells fill the right fields; bad cells are flagged, not dropped", () => {
  const text = F("Nickname"); const num = F("Siblings", "number"); const dt = F("Joined", "date"); const ch = F("House", "choice", { options: ["Red", "Blue"] });
  const yn = F("Bus", "yes_no"); const lt = F("About", "long_text");
  const headers = [...HEAD, "nickname *", "SIBLINGS", "Joined (required)", "House", "Bus", "About", "Shoe size"];
  const rep = {};
  const [a, b] = parse(headers, [
    std("Amy", "1,200", "31/12/2012", "red", "Y", "Line one\nline two", "38"),
    std("", "abc", "garbage", "Purple", "maybe", "", "40"),
  ], [text, num, dt, ch, yn, lt], rep);
  assert.deepStrictEqual(a.custom, { [text.id]: "Amy", [num.id]: "1200", [dt.id]: "2012-12-31", [ch.id]: "Red", [yn.id]: "yes", [lt.id]: "Line one\nline two" });
  assert.deepStrictEqual(a.customIssues, []);
  assert.deepStrictEqual(b.custom, { [ch.id]: "Purple" });
  assert.deepStrictEqual(b.customIssues.map((i) => `${i.label}:${i.reason}`), ["Siblings:number", "Joined:date", "House:choice", "Bus:yes/no"]);
  assert.strictEqual(b.customIssues[0].raw, "abc");
  assert.deepStrictEqual([...rep.unmatched], ["Shoe size"]);
  assert.strictEqual(rep.matched.size, 6);
});

test("with no custom fields the import behaves as before", () => {
  const students = parse([...HEAD, "Blood group"], [std("O+")], []);
  assert.strictEqual(students.length, 1);
  assert.strictEqual(students[0].custom, undefined);
  assert.strictEqual(students[0].firstName, "Ama");
  const none = parse([...HEAD], [std()], null);
  assert.strictEqual(none.length, 1);
  assert.strictEqual(none[0].custom, undefined);
});

test("empty and header-only files give nothing and don't throw", () => {
  const f = [F("Hobby")];
  assert.deepStrictEqual(pipe.detectHeaderAndDataRows([]), { headers: [], rows: [] });
  assert.deepStrictEqual(pipe.detectHeaderAndDataRows([HEAD]).rows, []);
  assert.deepStrictEqual(parse(HEAD, [], f), []);
  assert.deepStrictEqual(parse([], [], f), []);
  assert.deepStrictEqual(parse([], [["x"]], f), []);
  assert.deepStrictEqual(imp.parseCsv(""), []);
  assert.deepStrictEqual(imp.parseCsv("\n\n\r\n"), []);
  assert.deepStrictEqual(imp.parseCsv(Buffer.alloc(0)), []);
});

test("blank rows between rows are skipped; custom-only rows without a name are counted", () => {
  const f = F("Hobby");
  const rep = {};
  const rows = [std("Chess"), [], ["", "", "", "", "", "Tennis"], [null, undefined, "", " "], std("Golf")];
  const out = parse([...HEAD, "Hobby"], rows, [f], rep);
  assert.deepStrictEqual(out.map((s) => s.custom[f.id]), ["Chess", "Golf"]);
  assert.strictEqual(rep.skipped, 1);
  const matrix = [HEAD.concat("Hobby"), [], std("A"), [], [], std("B")];
  assert.strictEqual(pipe.detectHeaderAndDataRows(matrix).rows.length, 2);
});

test("a repeated header row in the middle of a file is not a student", () => {
  const f = F("Hobby");
  const out = parse([...HEAD, "Hobby"], [std("Chess"), [...HEAD, "Hobby"], std("Golf")], [f]);
  assert.strictEqual(out.length, 2);
});

test("a field named like a standard column never fills twice: the standard column wins", () => {
  const cls = F("Class"); const mail = F("Email"); const notes = F("Notes"); const home = F("Hometown");
  const rep = {};
  const [s] = parse([...HEAD, "Email", "Notes", "Hometown"], [std("a@b.test", "hello", "Accra")], [cls, mail, notes, home], rep);
  assert.strictEqual(s.class, "Class 1");
  assert.strictEqual(s.studentEmail, "a@b.test");
  assert.strictEqual(s.hometown, "Accra");
  assert.strictEqual(s.custom[cls.id], undefined);
  assert.strictEqual(s.custom[mail.id], undefined);
  assert.strictEqual(s.custom[home.id], undefined);
  assert.strictEqual(rep.matched.size <= 1, true);
});

test("a custom label that only partly looks like a standard one still fills its own field", () => {
  const f = F("Parent occupation"); const g = F("Home language"); const h = F("Class house");
  const [s] = parse([...HEAD, "Parent occupation", "Home language", "Class house"], [std("Nurse", "Twi", "Red")], [f, g, h]);
  assert.strictEqual(s.custom[f.id], "Nurse");
  assert.strictEqual(s.custom[g.id], "Twi");
  assert.strictEqual(s.custom[h.id], "Red");
  assert.strictEqual(s.class, "Class 1");
  assert.strictEqual(s.guardian.firstName, "");
});

test("exceljs style cells in a whole row", () => {
  const t = F("Site"); const n = F("Fee", "number"); const d = F("Joined", "date");
  const row = ["Ama", { richText: [{ text: "Men" }, { text: "sah" }] }, new Date(Date.UTC(2012, 4, 15)), { formula: "A1", result: "Female" }, { text: "Class 1", hyperlink: "x" },
    { text: "https://x.test", hyperlink: "https://x.test" }, { formula: "100+20", result: 120 }, 41000];
  const [s] = parse([...HEAD, "Site", "Fee", "Joined"], [row], [t, n, d]);
  assert.strictEqual(s.lastName, "Mensah");
  assert.strictEqual(s.dateOfBirth, "2012-05-15");
  assert.strictEqual(s.gender, "Female");
  assert.strictEqual(s.class, "Class 1");
  assert.strictEqual(s.custom[t.id], "https://x.test");
  assert.strictEqual(s.custom[n.id], "120");
  assert.strictEqual(s.custom[d.id], "2012-04-01");
  assert.ok(!JSON.stringify(s).includes("[object"));
});

test("sparse spreadsheet rows (holes) don't break the header or the data", () => {
  const f = F("Hobby");
  const header = []; header[0] = "First Name"; header[1] = "Last Name"; header[4] = "Class"; header[6] = "Hobby";
  const row = []; row[0] = "Ama"; row[1] = "Mensah"; row[6] = "Chess";
  const { headers, rows } = pipe.detectHeaderAndDataRows([header, row]);
  const [s] = parse(headers, rows, [f]);
  assert.strictEqual(s.custom[f.id], "Chess");
});

test("5,000 rows with 12 custom columns import quickly", () => {
  const fields = Array.from({ length: 12 }, (_, i) => F(`Extra ${i}`, ["text", "number", "date", "yes_no"][i % 4]));
  const headers = [...HEAD, ...fields.map((f) => f.label)];
  const rows = Array.from({ length: 5000 }, (_, i) => std(...fields.map((f, k) => ["abc", String(i), "05/06/2012", "yes"][k % 4])));
  const t = Date.now();
  const out = parse(headers, rows, fields);
  assert.strictEqual(out.length, 5000);
  assert.strictEqual(out[4999].custom[fields[1].id], "4999");
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t}ms`);
});

// ---------- CSV ----------

test("CSV: quoted commas, embedded newlines, escaped quotes, BOM, CRLF", () => {
  const csv = "﻿First Name,Last Name,Hobby\r\n\"Ama\",\"Mensah, Jr\",\"Likes \"\"chess\"\",\nand golf\"\r\nKofi,Owusu,\r\n";
  const rows = imp.parseCsv(Buffer.from(csv, "utf8"));
  assert.deepStrictEqual(rows[0], ["First Name", "Last Name", "Hobby"]);
  assert.deepStrictEqual(rows[1], ["Ama", "Mensah, Jr", 'Likes "chess",\nand golf']);
  assert.deepStrictEqual(rows[2], ["Kofi", "Owusu", ""]);
  assert.strictEqual(rows.length, 3);
});

test("CSV: semicolon and tab files, old Mac line ends, windows-1252 accents", () => {
  assert.deepStrictEqual(imp.parseCsv("a;b;c\n1;2,5;3")[1], ["1", "2,5", "3"]);
  assert.deepStrictEqual(imp.parseCsv("a\tb\n1\t2")[1], ["1", "2"]);
  assert.strictEqual(imp.parseCsv("a,b\r1,2\r3,4").length, 3);
  const latin = Buffer.from("Nom,Ville\nRené,Zürich", "latin1");
  assert.deepStrictEqual(imp.parseCsv(latin)[1], ["René", "Zürich"]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b\n1,2", "utf16le")]);
  assert.deepStrictEqual(imp.parseCsv(utf16)[1], ["1", "2"]);
});

test("CSV: broken quoting never throws or hangs", () => {
  for (const bad of ['a,"b\n1,2', '"""', ',,,,', '"', 'x,"y"z,w', "\u0000\u0001,a", "a,b\n".repeat(1000) + '"open']) {
    assert.doesNotThrow(() => imp.parseCsv(bad));
  }
});

test("a CSV with custom columns goes through the whole pipeline", () => {
  const f = [F("Allergy"), F("Siblings", "number")];
  const csv = "﻿First Name;Last Name;Date of Birth;Gender;Class;Allergy;Siblings\r\nAma;Mensah;2012-05-15;Female;Class 1;\"Peanuts; eggs\";2\r\n\r\nKofi;Owusu;2011-01-02;Male;Class 1;;x\r\n";
  const matrix = imp.parseCsv(Buffer.from(csv));
  const { headers, rows } = pipe.detectHeaderAndDataRows(matrix);
  const out = parse(headers, rows, f);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].custom[f[0].id], "Peanuts; eggs");
  assert.strictEqual(out[0].custom[f[1].id], "2");
  assert.strictEqual(out[1].customIssues[0].reason, "number");
});

// ---------- text documents ----------

test("Word / PDF text: 'Label: value' lines fill the student above them; never throws", () => {
  const f = [F("Blood group"), F("Siblings", "number"), F("Bus", "yes_no")];
  const text = "Ama, Mensah, 2012-05-15, Female, Class 1\nBlood group: O+\nSiblings: 3\nBus: yes\nKofi, Owusu, 2011-01-02, Male, Class 1\nSiblings: many\nUnknown: x";
  const rep = { matched: new Map(), unmatched: new Set() };
  const out = pipe.parseTextToStudents(text, f, rep);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0].custom, { [f[0].id]: "O+", [f[1].id]: "3", [f[2].id]: "yes" });
  assert.strictEqual(out[1].customIssues[0].reason, "number");
  for (const junk of ["", "\n\n", "Blood group: O+", ": :", "a:b:c", "\u0000", "x".repeat(100000)]) assert.doesNotThrow(() => pipe.parseTextToStudents(junk, f, { matched: new Map(), unmatched: new Set() }));
  assert.strictEqual(pipe.parseTextToStudents("Ama, Mensah, 2012-05-15, Female, Class 1", [], null).length, 1);
});

test("text with a header line also reads custom columns", () => {
  const f = [F("Blood group")];
  const out = pipe.parseTextToStudents("First Name, Last Name, Class, Blood group\nAma, Mensah, Class 1, A-", f, null);
  assert.strictEqual(out[0].custom[f[0].id], "A-");
});

// ---------- template ----------

test("the template has every standard column and one per active custom field", () => {
  const fields = [F("Blood group"), F("Siblings", "number", { required: true }), F("Old", "text", { status: "obsolete" }), F("Apply", "text", { onStudentForm: false }),
    F("House", "choice", { options: ["Red", "Blue"] }), F("Joined", "date"), F("Bus", "yes_no")];
  const m = imp.templateModel(fields, { sampleClass: "Class 1" });
  assert.deepStrictEqual(m.headers.slice(0, imp.STANDARD_HEADERS.length), imp.STANDARD_HEADERS);
  assert.deepStrictEqual(m.headers.slice(imp.STANDARD_HEADERS.length), ["Blood group", "Siblings *", "House", "Joined", "Bus"]);
  assert.strictEqual(m.sample.length, m.headers.length);
  assert.deepStrictEqual(m.sample.slice(imp.STANDARD_HEADERS.length), ["Example", 12, "Red", "2012-05-15", "Yes"]);
  // The template reads back through the importer: every sample value fits.
  const back = parse(m.headers, [m.sample.map(String)], fields.filter((f) => f.status === "active" && f.onStudentForm));
  assert.strictEqual(back.length, 1);
  assert.deepStrictEqual(back[0].customIssues, []);
  assert.strictEqual(Object.keys(back[0].custom).length, 5);
});

test("a template header that starts with = is exported quoted", () => {
  const csv = imp.toCsv([imp.templateModel([F("=1+1")]).headers]);
  assert.ok(csv.includes("'=1+1"));
});

// ---------- agrees with the saving side ----------

test("every value the import accepts also passes the form's own check", () => {
  const fields = [F("A", "text"), F("B", "long_text"), F("C", "number"), F("D", "date"), F("E", "choice", { options: ["One", "Two"] }), F("F", "yes_no")];
  const samples = ["", "x", "1,200", "12.5", "abc", "1e3", "٣", "31/12/2012", "05/06/2012", "41000", "garbage", "two", "TWO", "Three", "y", "N", "maybe", "=1+1", "a".repeat(5000), "  spaced   out  ", { richText: [{ text: "r" }] }, new Date(Date.UTC(2020, 1, 29)), 7, true, null];
  let accepted = 0;
  for (const f of fields) {
    for (const raw of samples) {
      const r = imp.coerceValue(f, raw);
      if (r.issue || r.value === "") continue;
      accepted += 1;
      assert.doesNotThrow(() => fieldsLib.checkAnswer(f, r.value), `${f.type} ${JSON.stringify(raw)} -> ${r.value}`);
    }
  }
  assert.ok(accepted > 40);
});

// ---------- database (local copy only; always rolled back) ----------

const dbUrl = process.env.DB_CONNECTION_STRING || "";
const localDb = /127\.0\.0\.1|localhost/.test(dbUrl);

test("imported answers save, read back and respect the field rules (rolled back)", { skip: !localDb && "needs the local test database" }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: dbUrl, ssl: process.env.DB_SSL === "false" ? false : undefined, max: 2 });
  const client = await pool.connect();
  try {
    await fieldsLib.ensureStudentFormFieldsSchema(pool);
    await client.query("BEGIN");
    const org = (await client.query("SELECT organization_id FROM organizations ORDER BY organization_id LIMIT 1")).rows[0].organization_id;
    const mk = (label, type, options, required) => fieldsLib.createField(client, org, { label, type, options, required, onStudentForm: true }, null);
    await mk("ImpTest Text", "text");
    await mk("ImpTest Number", "number");
    await mk("ImpTest Date", "date");
    await mk("ImpTest Choice", "choice", ["Red", "Blue"]);
    await mk("ImpTest Bus", "yes_no");
    await mk("ImpTest Notes", "long_text");
    await mk("ImpTest Needed", "text", [], true);
    await mk("ImpTest App only", "text").then(async (f) => client.query("UPDATE student_form_fields SET on_student_form = FALSE, on_application = TRUE WHERE label = 'ImpTest App only' AND organization_id = $1", [org]));
    const active = (await fieldsLib.formFields(client, org, "student")).filter((f) => f.label.startsWith("ImpTest"));
    assert.strictEqual(active.length, 7, "application-only field is not offered");
    const headers = [...HEAD, ...active.map((f) => f.label)];
    const [s] = parse(headers, [std("Hi", "1,200", "31/12/2012", "blue", "yes", "Long\ntext", "")], active);
    assert.deepStrictEqual(s.customIssues, []);
    // Required field is left empty: the form's check refuses it, like any other required input.
    const answersFor = (st) => fieldsLib.readAnswers(active, (name) => st.custom[Number(name.slice(2))] ?? "");
    assert.throws(() => answersFor(s), /required/i);
    s.custom[active[6].id] = "Filled";
    const answers = answersFor(s);
    const studentId = 987654321;
    await fieldsLib.saveStudentAnswers(client, org, studentId, answers, null);
    const saved = (await client.query("SELECT f.label, v.value FROM student_field_values v JOIN student_form_fields f USING (field_id) WHERE v.student_id = $1 ORDER BY f.field_id", [studentId])).rows;
    assert.deepStrictEqual(saved.map((r) => r.value), ["Hi", "1200", "2012-12-31", "Blue", "yes", "Long\ntext", "Filled"]);
    // A choice that is not an option is flagged on import and refused on save.
    const [bad] = parse(headers, [std("Hi", "5", "2012-01-01", "Purple", "yes", "", "x")], active);
    assert.strictEqual(bad.customIssues[0].reason, "choice");
    assert.throws(() => fieldsLib.readAnswers(active, (name) => bad.custom[Number(name.slice(2))] ?? ""), /options/i);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});
