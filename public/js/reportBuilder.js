(() => {
  const root = document.querySelector(".report-builder-page");
  if (!root || root.dataset.rbInitialized === "1") return;
  root.dataset.rbInitialized = "1";

  const data = window.reportBuilderData || {};
  const reportTypes = new Map((data.reportTypes || []).map((report) => [report.key, report]));
  // List entries; each has one or more views (report types).
  const families = new Map((data.families || []).map((family) => [family.key, family]));
  const familyOf = (reportType) => [...families.values()].find((family) => family.views.includes(reportType));
  const RUN_TIMEOUT_MS = 60000;
  const pageSizes = data.pageSizes || [25, 50, 100];
  const state = {
    step: 1,
    reportType: "",
    columns: [],
    criteria: {},
    criteriaOrder: [],
    options: {},
    page: 1,
    pageSize: pageSizes[0],
    sort: null,
    total: 0,
    hasRun: false,
    running: false,
    saved: null, // the saved report open in the builder: { report_id, report_name, is_owner, ... }
    savedReports: [...(data.savedReports || [])],
    staff: null,
    modal: null, // { name, reportId } — reportId is set when opened from My reports
    shareSelection: new Set(),
    runId: 0,
    savedSignature: "", // the open saved report's setup as last saved; Save is only offered after a change
    branding: {}, // header choices for exported files, kept with the saved report
  };

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  };

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === "dataset") Object.assign(node.dataset, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    });
    node.append(...children);
    return node;
  };
  const icon = (name) => {
    const span = el("span", { className: "rb-icon-glyph", "aria-hidden": "true" });
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return span;
  };
  const iconButton = (name, label, dataset, extraClass = "", disabled = false) =>
    el("button", { type: "button", className: `rb-icon-btn ${extraClass}`.trim(), dataset, disabled, title: label, "aria-label": label }, [icon(name)]);
  const report = () => reportTypes.get(state.reportType);
  const findSaved = (id) => state.savedReports.find((item) => String(item.report_id) === String(id));

  function showError(step, message = "") {
    const target = $(`[data-error-for="${step}"]`);
    if (target) target.textContent = message;
  }

  async function responseJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.error || "Something went wrong. Please try again.");
    return body;
  }

  const sendJson = (url, body, method = "POST") => fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const getJson = (url) => fetch(url, { headers: { Accept: "application/json" } }).then(responseJson);

  // ---- Steps ----------------------------------------------------------------

  function canVisit(step) {
    if (step === 1) return true;
    if (step <= 4) return Boolean(state.reportType && (step === 2 || state.columns.length));
    return state.hasRun;
  }

  function goTo(step) {
    if (!canVisit(step) || state.running) return;
    $$("[data-error-for]").forEach((node) => { node.textContent = ""; });
    if (step === 2) renderColumns();
    if (step === 3) renderCriteria();
    if (step === 5) renderFinish();
    state.step = step;
    $$("[data-step-panel]").forEach((panel) => { panel.hidden = Number(panel.dataset.stepPanel) !== step; });
    updateStepper();
    if (step === 4 && !state.hasRun) runReport();
  }

  function updateStepper() {
    $$("[data-step-nav]").forEach((button) => {
      const number = Number(button.dataset.stepNav);
      button.classList.toggle("is-current", number === state.step);
      button.classList.toggle("is-done", number < state.step);
      button.disabled = !canVisit(number) || state.running;
      if (number === state.step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    $("[data-next-step='2']").disabled = !state.reportType;
    $("[data-next-step='3']").disabled = !state.columns.length;
    $("[data-next-step='4']").disabled = !state.columns.length || state.running;
    $("[data-next-step='5']").disabled = !state.hasRun || state.running;
  }

  function invalidate() {
    state.hasRun = false;
    state.page = 1;
    updateStepper();
  }

  const viewTitle = (reportType) => {
    const family = familyOf(reportType);
    const current = reportTypes.get(reportType);
    if (!current) return "";
    return family && family.views.length > 1 ? `${current.title} · ${current.variant}` : current.title;
  };

  function setTitles() {
    const current = report();
    $$("[data-report-title]").forEach((node) => {
      node.textContent = current ? (state.saved ? `${state.saved.report_name} · ${current.title}` : current.title) : "";
    });
    renderViewSwitch();
  }

  // "Show" switch for entries with several views (e.g. Attendance: each mark / per student / per class & day).
  function renderViewSwitch() {
    const family = familyOf(state.reportType);
    $$("[data-view-switch]").forEach((node) => {
      if (!family || family.views.length < 2) {
        node.replaceChildren();
        return;
      }
      node.replaceChildren(
        el("span", { className: "rb-muted", textContent: "Show" }),
        ...family.views.map((key) => el("button", {
          type: "button",
          className: `rb-view${key === state.reportType ? " is-active" : ""}`,
          textContent: reportTypes.get(key).variant,
          dataset: { view: key },
          "aria-pressed": String(key === state.reportType),
        })),
      );
    });
  }

  function switchView(reportType) {
    const next = reportTypes.get(reportType);
    if (!next || reportType === state.reportType || state.running) return;
    const keepCriteria = state.criteriaOrder.filter((key) => next.criteria.some((criterion) => criterion.key === key));
    state.reportType = reportType;
    state.columns = [...next.defaultColumns];
    state.criteriaOrder = keepCriteria;
    state.criteria = Object.fromEntries(keepCriteria.map((key) => [key, state.criteria[key]]));
    state.sort = null;
    invalidate();
    markSelectedType();
    setTitles();
    if (state.step === 2) renderColumns();
    if (state.step === 3) renderCriteria();
    if (state.step === 4) runReport();
  }

  // ---- Step 1: saved reports and report types --------------------------------

  function savedMeta(saved) {
    const parts = [viewTitle(saved.report_type)];
    if (saved.owner_name) parts.push(`Created by ${saved.owner_name}`);
    if (saved.is_owner && saved.share_count) parts.push(`Shared with ${saved.share_count}`);
    if (saved.is_owner && saved.schedule_frequency) parts.push(`Emailed ${saved.schedule_frequency}`);
    return parts.filter(Boolean).join(" · ");
  }

  function renderSaved() {
    const query = $("#rb-saved-filter").value.trim().toLowerCase();
    // Favorites first, then by name.
    const items = state.savedReports
      .filter((saved) => `${saved.report_name} ${saved.owner_name || ""}`.toLowerCase().includes(query))
      .sort((a, b) => Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite)) || a.report_name.localeCompare(b.report_name));
    const rows = items.map((saved) => {
      const id = saved.report_id;
      const name = saved.report_name;
      const tools = [
        iconButton("star", saved.is_favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`, { favoriteSaved: id }, saved.is_favorite ? "is-on" : ""),
        iconButton("download", `Export ${name}`, { openModal: "download", reportId: id }),
      ];
      if (saved.is_owner) {
        tools.push(iconButton("share", `Share ${name}`, { openModal: "share", reportId: id }));
        tools.push(iconButton("gear", `Edit ${name}`, { editSaved: id }));
        tools.push(iconButton("trash", `Delete ${name}`, { deleteSaved: id }, "is-danger"));
      }
      // Icons on the left; the name on top and who made it underneath.
      return el("li", { className: "rb-row rb-saved-row" }, [
        el("span", { className: "rb-row-tools" }, tools),
        el("a", { href: "#", className: "rb-row-link rb-saved-link", dataset: { loadSaved: id } }, [
          el("span", { className: "rb-row-name", textContent: name }),
          el("span", { className: "rb-saved-meta", textContent: savedMeta(saved) }),
        ]),
      ]);
    });
    if (!rows.length) {
      rows.push(el("li", { className: "rb-empty", textContent: state.savedReports.length ? "No saved reports match." : "Reports you save, and reports shared with you, appear here." }));
    }
    $("#rb-saved-list").replaceChildren(...rows);
  }

  function markSelectedType() {
    const family = familyOf(state.reportType);
    $$("[data-family]").forEach((link) => {
      const selected = link.dataset.family === family?.key;
      link.classList.toggle("is-selected", selected);
      link.setAttribute("aria-pressed", String(selected));
      link.querySelector(".rb-check").replaceChildren(...(selected ? [icon("check")] : []));
    });
  }

  // Some reports start with criteria in place (the merit sheet starts with
  // Class and this term).
  function applyDefaultCriteria(next) {
    state.criteria = {};
    state.criteriaOrder = (next.defaultCriteria || []).filter((key) => next.criteria.some((criterion) => criterion.key === key));
    const currentTerm = (data.terms || []).find((term) => term.is_current);
    if (state.criteriaOrder.includes("term") && currentTerm) state.criteria.term = [String(currentTerm.term_id)];
  }

  function selectType(reportType, { keepSaved = false } = {}) {
    const next = reportTypes.get(reportType);
    if (!next || state.running) return;
    if (state.reportType !== reportType || !keepSaved) {
      if (state.reportType !== reportType) {
        state.columns = [...next.defaultColumns];
        state.sort = null;
        applyDefaultCriteria(next);
      }
      state.reportType = reportType;
      if (!keepSaved) {
        state.saved = null;
        state.branding = {};
      }
      $("#rb-column-search").value = "";
      $("#rb-criteria-search").value = "";
      invalidate();
    }
    markSelectedType();
    setTitles();
    showError(1);
    updateStepper();
  }

  // ---- Step 2: columns ------------------------------------------------------

  function pickRow(label, dataset) {
    return el("li", { className: "rb-row" }, [el("a", { href: "#", className: "rb-row-link rb-pick", dataset }, [
      el("span", { className: "rb-pick-icon" }, [icon("plus")]),
      el("span", { className: "rb-row-text" }, [el("span", { className: "rb-row-name", textContent: label })]),
    ])]);
  }

  // Items with a group (e.g. one column per subject) fold under their group's
  // heading: closed until clicked, open while searching. Ungrouped items come first.
  const openGroups = new Set();
  function groupedRows(items, query, pick) {
    const rows = items.filter((item) => !item.group).map(pick);
    const groups = new Map();
    items.filter((item) => item.group).forEach((item) => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    });
    groups.forEach((members, name) => {
      const open = Boolean(query) || openGroups.has(name);
      rows.push(el("li", { className: "rb-group" }, [el("button", {
        type: "button", className: "rb-group-toggle", dataset: { toggleGroup: name }, "aria-expanded": String(open),
      }, [
        el("span", { className: "rb-group-name", textContent: name }),
        el("span", { className: "rb-group-count", textContent: String(members.length) }),
        el("span", { className: "rb-group-chev", "aria-hidden": "true", textContent: "›" }),
      ])]));
      if (open) members.forEach((item) => rows.push(pick(item)));
    });
    return rows;
  }

  function syncFoldAll(list, items) {
    const button = root.querySelector(`[data-fold-all="${list}"]`);
    if (!button) return;
    const names = [...new Set(items.map((item) => item.group).filter(Boolean))];
    button.hidden = names.length < 2;
    button.textContent = names.length && names.every((name) => openGroups.has(name)) ? "Collapse all" : "Expand all";
  }

  function renderColumns() {
    const current = report();
    if (!current) return;
    const labels = new Map(current.columns.map((column) => [column.key, column.label]));
    const query = $("#rb-column-search").value.trim().toLowerCase();
    const available = current.columns.filter((column) => !state.columns.includes(column.key) && column.label.toLowerCase().includes(query));
    // School-specific columns (e.g. one per subject) follow under their own heading.
    const rows = groupedRows(available, query, (column) => pickRow(column.label, { addColumn: column.key }));
    if (!rows.length) rows.push(el("li", { className: "rb-empty", textContent: query ? "No columns match." : "All columns are in the report." }));
    $("#rb-available-columns").replaceChildren(...rows);
    syncFoldAll("columns", current.columns);

    const chosen = state.columns.map((key, index) => el("li", { className: "rb-chosen-row" }, [
      el("span", { className: "rb-chosen-index", textContent: String(index + 1) }),
      el("span", { className: "rb-chosen-label", textContent: labels.get(key) }),
      el("span", { className: "rb-row-tools" }, [
        iconButton("up", `Move ${labels.get(key)} up`, { moveColumn: key, dir: "-1" }, "", index === 0),
        iconButton("down", `Move ${labels.get(key)} down`, { moveColumn: key, dir: "1" }, "", index === state.columns.length - 1),
        iconButton("close", `Remove ${labels.get(key)}`, { removeColumn: key }, "is-danger"),
      ]),
    ]));
    if (!chosen.length) chosen.push(el("li", { className: "rb-empty", textContent: "Add at least one column." }));
    $("#rb-selected-columns").replaceChildren(...chosen);
    $("#rb-column-count").textContent = `(${state.columns.length})`;
    updateStepper();
  }

  function changeColumns(columns) {
    state.columns = columns;
    if (state.sort && !columns.includes(state.sort.key)) state.sort = null;
    invalidate();
    renderColumns();
  }

  // ---- Step 3: criteria -----------------------------------------------------

  async function loadOptions() {
    const current = report();
    if (!current || state.options[current.key] || !current.criteria.some((criterion) => criterion.hasOptions)) return;
    try {
      const result = await getJson(`/common/report-builder/options/${encodeURIComponent(current.key)}`);
      state.options[current.key] = result.options || {};
      if (state.step === 3 && state.reportType === current.key) renderCriteria();
    } catch (error) {
      showError(3, error.message);
    }
  }

  function optionsFor(criterion) {
    if (criterion.type === "class") return (data.classes || []).map((item) => ({ value: String(item.class_id), label: item.class_name }));
    if (criterion.type === "term") return (data.terms || []).map((item) => ({ value: String(item.term_id), label: item.term_name }));
    if (criterion.type === "choice") return criterion.options || [];
    return state.options[state.reportType]?.[criterion.key] || null;
  }

  function criterionControl(criterion) {
    const value = state.criteria[criterion.key];
    const update = (next) => { state.criteria[criterion.key] = next; invalidate(); };
    if (criterion.type === "text") {
      const input = el("input", {
        className: "rb-input", type: "text", maxLength: 500, value: value || "",
        placeholder: "One or more, separated by commas", "aria-label": criterion.label,
      });
      input.addEventListener("input", () => update(input.value));
      return input;
    }
    if (criterion.type === "date") {
      const range = value || {};
      const from = el("input", { className: "rb-input", type: "date", value: range.from || "", "aria-label": `${criterion.label} from` });
      const to = el("input", { className: "rb-input", type: "date", value: range.to || "", "aria-label": `${criterion.label} to` });
      const change = () => update({ from: from.value, to: to.value });
      from.addEventListener("change", change);
      to.addEventListener("change", change);
      return el("span", { className: "rb-date-range" }, [from, el("span", { className: "rb-muted", textContent: "to" }), to]);
    }
    if (criterion.type === "scale") {
      // Raw scores, each class's Report Settings, or every subject out of a number the school picks.
      const custom = value && value !== "settings";
      const select = el("select", { className: "rb-input", "aria-label": criterion.label });
      select.append(
        el("option", { value: "", textContent: "Raw scores" }),
        el("option", { value: "settings", textContent: "As in Report Settings", selected: value === "settings" }),
        el("option", { value: "custom", textContent: "Each subject out of…", selected: Boolean(custom) }));
      const number = el("input", { className: "rb-input rb-scale-number", type: "number", min: "1", max: "1000", step: "any",
        value: custom ? value : "100", "aria-label": "Each subject out of", hidden: !custom });
      // Under "As in Report Settings": what each class's setting is (read-only).
      const note = el("span", { className: "rb-scale-note" });
      const showSettings = () => {
        note.hidden = select.value !== "settings";
        if (note.hidden) return;
        const rows = state.options[state.reportType]?.scale;
        if (!rows) { note.textContent = "Loading the classes' settings…"; return; }
        const chosen = asList(state.criteria.class);
        const shown = chosen.length ? rows.filter((row) => chosen.includes(row.value)) : rows;
        note.replaceChildren(el("strong", { textContent: "Report Settings (change them in Report Settings → Advanced):" }),
          ...shown.map((row) => el("span", { textContent: row.label })));
      };
      const sync = () => {
        number.hidden = select.value !== "custom";
        update(select.value === "custom" ? number.value : select.value);
        showSettings();
      };
      select.addEventListener("change", sync);
      number.addEventListener("input", sync);
      showSettings();
      return el("span", { className: "rb-scale-wrap" }, [el("span", { className: "rb-scale" }, [select, number]), note]);
    }
    const options = optionsFor(criterion);
    if (MULTI_TYPES.has(criterion.type)) return multiSelect(criterion, options, value, update);
    // Bands such as "Top 5" or "Below 50%" are one choice at a time.
    const select = el("select", { className: "rb-input", "aria-label": criterion.label });
    select.append(el("option", { value: "", textContent: "Any" }), ...options.map((option) =>
      el("option", { value: option.value, textContent: option.label, selected: String(value ?? "") === option.value })));
    select.addEventListener("change", () => update(select.value));
    return select;
  }

  // Class, term and list filters: pick one or more values from a tick list.
  const MULTI_TYPES = new Set(["class", "term", "select"]);
  const asList = (value) => (Array.isArray(value) ? value : (value === undefined || value === null || value === "" ? [] : [value]))
    .map(String);

  function multiSelect(criterion, options, value, update) {
    const button = el("button", { type: "button", className: "rb-input rb-multi-button", "aria-expanded": "false", "aria-label": criterion.label });
    if (!options) {
      button.append(el("span", { textContent: "Loading…" }));
      button.disabled = true;
      return el("div", { className: "rb-multi" }, [button]);
    }
    const selected = new Set(asList(value).filter((item) => options.some((option) => option.value === item)));
    const labelOf = new Map(options.map((option) => [option.value, option.label]));
    const summary = el("span", { className: "rb-multi-summary" });
    const caret = el("span", { className: "rb-multi-caret", "aria-hidden": "true", textContent: "▾" });
    button.append(summary, caret);
    const showSummary = () => {
      const labels = [...selected].map((item) => labelOf.get(item));
      summary.textContent = !labels.length ? "Any"
        : labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
      summary.classList.toggle("rb-muted", !labels.length);
    };
    const search = options.length > 8
      ? el("input", { className: "rb-input rb-multi-search", type: "search", placeholder: `Find ${criterion.label.toLowerCase()}`, "aria-label": `Find ${criterion.label}` })
      : null;
    const list = el("div", { className: "rb-multi-list", role: "group", "aria-label": criterion.label }, options.map((option) =>
      el("label", { className: "rb-checkline", dataset: { label: option.label.toLowerCase() } }, [
        el("input", { type: "checkbox", value: option.value, checked: selected.has(option.value) }),
        el("span", { textContent: option.label }),
      ])));
    if (!options.length) list.append(el("p", { className: "rb-empty", textContent: "Nothing to choose yet." }));
    const clear = el("button", { type: "button", className: "rb-btn rb-btn-light rb-btn-sm", textContent: "Clear" });
    const done = el("button", { type: "button", className: "rb-btn rb-btn-primary rb-btn-sm", textContent: "Done" });
    const panel = el("div", { className: "rb-multi-panel", hidden: true }, [
      ...(search ? [search] : []), list, el("div", { className: "rb-multi-actions" }, [clear, done]),
    ]);
    const setOpen = (open) => {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open && search) search.focus();
    };
    const commit = () => { update([...selected]); showSummary(); };
    button.addEventListener("click", () => setOpen(panel.hidden));
    done.addEventListener("click", () => setOpen(false));
    clear.addEventListener("click", () => {
      selected.clear();
      list.querySelectorAll("input").forEach((box) => { box.checked = false; });
      commit();
    });
    list.addEventListener("change", (event) => {
      if (event.target.checked) selected.add(event.target.value);
      else selected.delete(event.target.value);
      commit();
    });
    search?.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      list.querySelectorAll("label").forEach((row) => { row.hidden = !row.dataset.label.includes(query); });
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.focus();
      }
    });
    showSummary();
    return el("div", { className: "rb-multi" }, [button, panel]);
  }

  function renderCriteria() {
    const current = report();
    if (!current) return;
    const byKey = new Map(current.criteria.map((criterion) => [criterion.key, criterion]));
    const query = $("#rb-criteria-search").value.trim().toLowerCase();
    const available = current.criteria.filter((criterion) =>
      !state.criteriaOrder.includes(criterion.key) && criterion.label.toLowerCase().includes(query));
    const rows = groupedRows(available, query, (criterion) => pickRow(criterion.label, { addCriterion: criterion.key }));
    if (!rows.length) rows.push(el("li", { className: "rb-empty", textContent: query ? "No criteria match." : "All criteria are in use." }));
    $("#rb-available-criteria").replaceChildren(...rows);
    syncFoldAll("criteria", current.criteria);

    const chosen = state.criteriaOrder.map((key) => {
      const criterion = byKey.get(key);
      return el("li", { className: "rb-chosen-row rb-criterion" }, [
        el("span", { className: "rb-chosen-label", textContent: criterion.label }),
        el("span", { className: "rb-criterion-control" }, [criterionControl(criterion)]),
        el("span", { className: "rb-row-tools" }, [iconButton("close", `Remove ${criterion.label}`, { removeCriterion: key }, "is-danger")]),
      ]);
    });
    if (!chosen.length) chosen.push(el("li", { className: "rb-empty", textContent: "No criteria added. The report will include all records." }));
    $("#rb-selected-criteria").replaceChildren(...chosen);
    $("#rb-criteria-count").textContent = `(${state.criteriaOrder.length})`;
    loadOptions();
  }

  function requestCriteria() {
    const criteria = {};
    state.criteriaOrder.forEach((key) => {
      const value = state.criteria[key];
      if (Array.isArray(value)) {
        if (value.length) criteria[key] = value.map(String);
      } else if (value && typeof value === "object") {
        if (value.from || value.to) criteria[key] = value;
      } else if (value !== undefined && String(value).trim() !== "") {
        criteria[key] = String(value).trim();
      }
    });
    return criteria;
  }

  const currentDefinition = () => ({ reportType: state.reportType, columns: state.columns, criteria: requestCriteria() });

  // ---- Step 4: results ------------------------------------------------------

  function formatValue(value, type) {
    if (value === null || value === undefined || value === "") return "—";
    if (type === "datetime") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
    if (type === "date") {
      const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { dateStyle: "medium" });
    }
    if (type === "money" && Number.isFinite(Number(value))) {
      return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (type === "number" && Number.isFinite(Number(value))) return Number(value).toLocaleString();
    return String(value);
  }

  function renderResults(result) {
    const numeric = (column) => ["number", "money"].includes(column.type);
    $(".rb-table").style.minWidth = `${result.columns.length * 170}px`;
    $("#rb-table-head").replaceChildren(el("tr", {}, result.columns.map((column) => {
      const active = result.sort?.key === column.key;
      const arrow = active ? (result.sort.dir === "asc" ? " ▲" : " ▼") : "";
      return el("th", { scope: "col", className: numeric(column) ? "is-number" : "" }, [
        el("button", { type: "button", className: `rb-sort${active ? " is-active" : ""}`, textContent: column.label + arrow, dataset: { sortKey: column.key } }),
      ]);
    })));
    const rows = result.rows.map((record) => el("tr", {}, result.columns.map((column) =>
      el("td", { className: numeric(column) ? "is-number" : "" }, [
        el("span", { className: "rb-cell", textContent: formatValue(record[column.key], column.type) }),
      ]))));
    if (!rows.length) rows.push(el("tr", {}, [el("td", { colSpan: result.columns.length, className: "rb-no-rows", textContent: "No records match this report." })]));
    // Totals over all matching records (Summary → Totals): a footer under the
    // records, one line per class, then the overall total in a larger row.
    const footRows = [];
    if (result.summary && result.summary.rows.length) {
      result.summary.rows.forEach((line, index) => {
        const grand = index === result.summary.rows.length - 1;
        footRows.push(el("tr", { className: `rb-total-row${grand ? " is-grand" : ""}` }, result.columns.map((column, i) => {
          const value = line.values[column.key];
          if (i === 0) {
            return el("th", { scope: "row" }, [
              el("span", { className: "rb-total-label", textContent: grand ? (result.summary.byClass ? "Overall total" : "Total") : line.label }),
              el("span", { className: "rb-total-count", textContent: `${Number(line.records).toLocaleString()} ${line.records === 1 ? "record" : "records"}` }),
            ]);
          }
          if (!value) return el("td", {});
          return el("td", { className: "is-number" }, [
            value.total !== null ? el("span", { className: "rb-total", textContent: formatValue(value.total, column.type) }) : "",
            el("span", { className: "rb-average", textContent: `${value.total !== null ? "avg " : "Average "}${formatValue(value.average, column.type)}` }),
          ]);
        })));
      });
    }
    $("#rb-table-foot").replaceChildren(...footRows);
    $("#rb-table-body").replaceChildren(...rows);
    $(".rb-table-box").scrollTo({ top: 0, left: 0 });

    const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
    const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
    const end = Math.min(result.page * result.pageSize, result.total);
    $("#rb-range").textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${result.total.toLocaleString()}`;
    $("#rb-page-label").textContent = `Page ${result.page} of ${pages}`;
    $("#rb-prev").disabled = result.page <= 1;
    $("#rb-next").disabled = result.page >= pages;
    $("#rb-results-status").textContent = `${result.total.toLocaleString()} ${result.total === 1 ? "record" : "records"}`;
  }

  // Runs the report with a visible "getting your report" state, a time limit,
  // and a Try again button; a late answer from an older run is ignored.
  async function runReport(page = 1) {
    if (!state.reportType || !state.columns.length || state.running) return;
    const runId = ++state.runId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    state.running = true;
    state.lastRunPage = page;
    updateStepper();
    showError(4);
    $("#rb-run-error").hidden = true;
    $("#rb-loading").hidden = false;
    $("#rb-results-status").textContent = "";
    root.classList.add("is-running");
    try {
      const response = await fetch("/common/report-builder/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...currentDefinition(), sort: state.sort, page, pageSize: state.pageSize }),
        signal: controller.signal,
      });
      const result = await responseJson(response);
      if (runId !== state.runId) return;
      state.hasRun = true;
      state.page = result.page;
      state.total = result.total;
      state.sort = result.sort;
      renderResults(result);
    } catch (error) {
      if (runId !== state.runId) return;
      state.hasRun = false;
      $("#rb-run-error-text").textContent = error.name === "AbortError"
        ? "This is taking longer than expected. Try again, or add criteria to narrow the report."
        : (error instanceof TypeError ? "Can't reach the server. Check your connection and try again." : error.message);
      $("#rb-run-error").hidden = false;
    } finally {
      clearTimeout(timer);
      if (runId === state.runId) {
        state.running = false;
        $("#rb-loading").hidden = true;
        root.classList.remove("is-running");
        updateStepper();
      }
    }
  }

  // ---- Step 5: actions -----------------------------------------------------------

  const status = (message) => { $("#rb-save-status").textContent = message; };
  const ownsSaved = () => Boolean(state.saved?.is_owner);

  const BRAND_KEYS = ["orgName", "logo", "address", "phone", "date"];
  const normalizeBranding = (raw) => ({
    ...Object.fromEntries(BRAND_KEYS.map((key) => [key, Boolean(raw && raw[key] === true)])),
    align: raw?.align === "center" ? "center" : "left",
  });
  // A saved report counts as changed when its setup, name or header choices differ from what was saved.
  const signature = (name = state.saved?.report_name, branding = state.branding) =>
    JSON.stringify({ ...currentDefinition(), name, branding });
  const markSaved = () => { state.savedSignature = signature(); };

  function renderFinish() {
    $("[data-step-panel='5'] [data-open-modal='share']").hidden = !ownsSaved();
    $("[data-step-panel='5'] [data-open-modal='schedule']").hidden = !ownsSaved();
    setTitles();
  }

  function upsertSaved(saved) {
    const existing = findSaved(saved.report_id) || {};
    state.savedReports = state.savedReports.filter((item) => String(item.report_id) !== String(saved.report_id));
    state.savedReports.push({ ...existing, ...saved });
    renderSaved();
  }

  // ---- Small windows -------------------------------------------------------------

  const modalNode = (name) => $(`[data-modal="${name}"]`);
  const modalStatus = (message) => {
    const node = state.modal && modalNode(state.modal.name).querySelector("[data-modal-status]");
    if (node) node.textContent = message;
  };
  // The saved report a window works on: the one picked in My reports, or the open one.
  const modalReportId = () => state.modal?.reportId || state.saved?.report_id || null;

  function openModal(name, reportId = null) {
    closeModal();
    state.modal = { name, reportId };
    const node = modalNode(name);
    node.querySelector("[data-modal-status]").textContent = "";
    node.hidden = false;
    if (name === "save") openSaveWindow();
    if (name === "share" || name === "schedule") loadSharing(name);
    if (name === "download") node.querySelector("[data-export]").focus();
  }

  function closeModal() {
    if (!state.modal) return;
    modalNode(state.modal.name).hidden = true;
    state.modal = null;
  }

  // ---- Save window: name, header choices and a live preview ---------------------

  const brandBoxes = () => [...modalNode("save").querySelectorAll("[data-brand]")];
  const chosenBranding = () => ({
    ...Object.fromEntries(brandBoxes().map((box) => [box.dataset.brand, box.checked])),
    align: state.saveAlign === "center" ? "center" : "left",
  });

  function openSaveWindow() {
    const owned = ownsSaved();
    $("#rb-report-name").value = owned ? state.saved.report_name : (state.saved ? `${state.saved.report_name} (copy)` : "");
    brandBoxes().forEach((box) => { box.checked = Boolean(state.branding[box.dataset.brand]); });
    state.saveAlign = state.branding.align === "center" ? "center" : "left";
    $("#rb-duplicate").hidden = !state.saved;
    $("#rb-save-new").hidden = !owned;
    renderSaveWindow();
    $("#rb-report-name").focus();
  }

  function renderSaveWindow() {
    const branding = chosenBranding();
    const name = $("#rb-report-name").value.trim();
    modalNode("save").querySelectorAll("[data-align]").forEach((button) => {
      const active = button.dataset.align === branding.align;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    // Owners save changes to the same report; Save stays off until something changed.
    $("#rb-save-submit").disabled = ownsSaved() && signature(name, branding) === state.savedSignature;
    const school = data.school || {};
    const lines = [];
    if (branding.orgName && school.name) lines.push(el("strong", { textContent: school.name }));
    if (branding.address && school.address) lines.push(el("span", { textContent: school.address }));
    if (branding.phone && school.phone) lines.push(el("span", { textContent: school.phone }));
    if (branding.date) lines.push(el("span", { textContent: `Generated ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` }));
    const preview = $("#rb-brand-preview");
    preview.classList.toggle("is-center", branding.align === "center");
    if (!lines.length && !(branding.logo && school.logo)) {
      preview.replaceChildren(el("span", { className: "rb-muted", textContent: "No header. Exports start with the report name." }));
      return;
    }
    preview.replaceChildren(
      ...(branding.logo && school.logo ? [el("img", { src: school.logo, alt: "", className: "rb-brand-logo" })] : []),
      el("span", { className: "rb-brand-lines" }, lines),
    );
  }

  async function submitSave(mode) {
    const name = $("#rb-report-name").value.trim();
    if (!name && mode !== "duplicate") {
      modalStatus("Enter a name for this report.");
      $("#rb-report-name").focus();
      return;
    }
    const branding = chosenBranding();
    const buttons = modalNode("save").querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    modalStatus("Saving…");
    try {
      let result;
      if (mode === "update") {
        result = await responseJson(await sendJson(`/common/report-builder/saved/${state.saved.report_id}`, { ...currentDefinition(), name, branding }, "PUT"));
      } else {
        const newName = mode === "duplicate" ? `${state.saved.report_name} (copy)`.slice(0, 120) : name;
        result = await responseJson(await sendJson("/common/report-builder/save", { ...currentDefinition(), name: newName, branding }));
      }
      state.saved = { ...(mode === "update" ? state.saved : {}), ...result.report, is_owner: true };
      state.branding = normalizeBranding(branding);
      upsertSaved(state.saved);
      markSaved();
      closeModal();
      renderFinish();
      status("");
    } catch (error) {
      modalStatus(error.message);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      if (state.modal?.name === "save") renderSaveWindow();
    }
  }

  async function exportReport(button) {
    const format = button.dataset.export;
    const reportId = state.modal?.reportId;
    $$("[data-export]").forEach((choice) => { choice.disabled = true; });
    modalStatus("Preparing your file…");
    try {
      let body;
      if (reportId) {
        const saved = (await getJson(`/common/report-builder/saved/${encodeURIComponent(reportId)}`)).report;
        body = { reportType: saved.report_type, columns: saved.columns_json, criteria: saved.criteria_json, name: saved.report_name, branding: saved.branding_json || {} };
      } else {
        body = { ...currentDefinition(), sort: state.sort, name: state.saved?.report_name || "", branding: state.branding };
      }
      // A template (.mgrt) is the design only; the other formats carry the data.
      const response = format === "mgrt"
        ? await sendJson("/common/report-builder/template", body)
        : await sendJson("/common/report-builder/export", { ...body, format });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Could not export this report.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileName = (disposition.match(/filename="([^"]+)"/) || [])[1] || `report.${format}`;
      const url = URL.createObjectURL(await response.blob());
      const link = el("a", { href: url, download: fileName });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      modalStatus(format === "mgrt" ? `Saved ${fileName}. Share it with anyone using Managira.` : `Exported ${fileName}.`);
    } catch (error) {
      modalStatus(error.message);
    } finally {
      $$("[data-export]").forEach((choice) => { choice.disabled = false; });
    }
  }

  function renderStaff() {
    const query = $("#rb-staff-filter").value.trim().toLowerCase();
    const people = (state.staff || []).filter((person) => person.name.toLowerCase().includes(query));
    const rows = people.map((person) => el("li", {}, [el("label", { className: "rb-checkline" }, [
      el("input", { type: "checkbox", value: String(person.user_id), checked: state.shareSelection.has(String(person.user_id)) }),
      el("span", { textContent: person.name }),
      el("span", { className: "rb-muted", textContent: person.role }),
    ])]));
    if (!rows.length) rows.push(el("li", { className: "rb-empty", textContent: state.staff ? "No one matches." : "Loading…" }));
    $("#rb-staff-list").replaceChildren(...rows);
  }

  const weekdayBoxes = () => [...modalNode("schedule").querySelectorAll("input[name='rb-weekday']")];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function updateScheduleFields() {
    const frequency = $("#rb-frequency").value;
    $("#rb-weekday-field").hidden = frequency !== "weekly";
    $("#rb-monthday-field").hidden = frequency !== "monthly";
    modalNode("schedule").querySelectorAll("[data-when-on]").forEach((node) => { node.hidden = !frequency; });
    const email = data.userEmail || "your email";
    $("#rb-recipient").textContent = $("#rb-include-shared").checked
      ? `Sent to ${email} and the people it's shared with, at the chosen time (school time).`
      : `Sent to ${email} at the chosen time (school time).`;
  }

  async function loadSharing(name) {
    const reportId = modalReportId();
    if (!reportId) return;
    state.shareSelection = new Set();
    $("#rb-staff-filter").value = "";
    if (name === "share") renderStaff();
    modalStatus("Loading…");
    try {
      const [staff, sharing] = await Promise.all([
        state.staff ? { staff: state.staff } : getJson("/common/report-builder/staff"),
        getJson(`/common/report-builder/saved/${reportId}/sharing`),
      ]);
      if (!state.modal || String(modalReportId()) !== String(reportId)) return;
      state.staff = staff.staff;
      state.shareSelection = new Set(sharing.userIds.map(String));
      renderStaff();
      const schedule = sharing.schedule || {};
      // Older daily schedules show as weekly on every day.
      const frequency = schedule.frequency === "daily" ? "weekly" : (schedule.frequency || "");
      const days = schedule.frequency === "daily" ? [0, 1, 2, 3, 4, 5, 6]
        : (Array.isArray(schedule.weekdays) && schedule.weekdays.length ? schedule.weekdays : [schedule.weekday ?? 1]);
      $("#rb-frequency").value = frequency;
      weekdayBoxes().forEach((box) => { box.checked = days.map(String).includes(box.value); });
      $("#rb-monthday").value = String(schedule.month_day ?? 1);
      $("#rb-send-hour").value = String(schedule.send_hour ?? 7);
      $("#rb-format").value = schedule.file_format || "xlsx";
      $("#rb-include-shared").checked = Boolean(schedule.include_shared);
      updateScheduleFields();
      modalStatus("");
    } catch (error) {
      modalStatus(error.message);
    }
  }

  async function saveShares(button) {
    const reportId = modalReportId();
    button.disabled = true;
    try {
      const result = await responseJson(await sendJson(`/common/report-builder/saved/${reportId}/shares`, { userIds: [...state.shareSelection] }, "PUT"));
      upsertSaved({ report_id: reportId, share_count: result.userIds.length });
      if (String(state.saved?.report_id) === String(reportId)) state.saved.share_count = result.userIds.length;
      closeModal();
      const message = result.userIds.length ? `Shared with ${result.userIds.length} ${result.userIds.length === 1 ? "person" : "people"}.` : "Sharing turned off.";
      status(message);
      showError(1);
    } catch (error) {
      modalStatus(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function saveSchedule(button) {
    const reportId = modalReportId();
    button.disabled = true;
    try {
      const result = await responseJson(await sendJson(`/common/report-builder/saved/${reportId}/schedule`, {
        frequency: $("#rb-frequency").value,
        weekdays: weekdayBoxes().filter((box) => box.checked).map((box) => Number(box.value)),
        monthDay: Number($("#rb-monthday").value),
        sendHour: Number($("#rb-send-hour").value),
        format: $("#rb-format").value,
        includeShared: $("#rb-include-shared").checked,
      }, "PUT"));
      upsertSaved({ report_id: reportId, schedule_frequency: result.schedule?.frequency || null });
      if (String(state.saved?.report_id) === String(reportId)) state.saved.schedule_frequency = result.schedule?.frequency || null;
      let message = "Email schedule turned off.";
      if (result.schedule) {
        const time = $("#rb-send-hour").selectedOptions[0].textContent;
        const days = result.schedule.weekdays || [];
        const when = result.schedule.frequency === "weekly"
          ? (days.length === 7 ? "every day" : `every ${days.map((day) => DAY_NAMES[day]).join(", ")}`)
          : `on day ${result.schedule.month_day} of each month`;
        message = `Scheduled: emailed ${when} at ${time}.`;
      }
      closeModal();
      status(message);
    } catch (error) {
      modalStatus(error.message);
    } finally {
      button.disabled = false;
    }
  }

  // ---- Saved reports ------------------------------------------------------------

  async function openSaved(reportId, { edit = false } = {}) {
    showError(1);
    try {
      const saved = (await getJson(`/common/report-builder/saved/${encodeURIComponent(reportId)}`)).report;
      state.saved = { ...(findSaved(saved.report_id) || {}), report_id: saved.report_id, report_name: saved.report_name, report_type: saved.report_type, is_owner: saved.is_owner };
      const current = reportTypes.get(saved.report_type);
      state.reportType = "";
      selectType(saved.report_type, { keepSaved: true });
      const columns = Array.isArray(saved.columns_json) ? saved.columns_json : [];
      state.columns = columns.filter((key) => current.columns.some((column) => column.key === key));
      if (!state.columns.length) state.columns = [...current.defaultColumns];
      const criteria = saved.criteria_json && typeof saved.criteria_json === "object" ? saved.criteria_json : {};
      state.criteria = {};
      state.criteriaOrder = current.criteria.map((criterion) => criterion.key).filter((key) => Object.hasOwn(criteria, key));
      state.criteriaOrder.forEach((key) => { state.criteria[key] = criteria[key]; });
      state.sort = null;
      state.branding = normalizeBranding(saved.branding_json);
      markSaved();
      invalidate();
      goTo(edit ? 2 : 4);
    } catch (error) {
      showError(1, error.message);
    }
  }

  async function toggleFavorite(reportId, button) {
    const saved = findSaved(reportId);
    if (!saved) return;
    button.disabled = true;
    try {
      await responseJson(await sendJson(`/common/report-builder/saved/${encodeURIComponent(reportId)}/favorite`, { favorite: !saved.is_favorite }, "PUT"));
      saved.is_favorite = !saved.is_favorite;
      renderSaved();
    } catch (error) {
      showError(1, error.message);
      button.disabled = false;
    }
  }

  async function deleteSaved(reportId, button) {
    if (!window.confirm("Delete this saved report? People it is shared with will lose it too.")) return;
    button.disabled = true;
    try {
      await responseJson(await fetch(`/common/report-builder/saved/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      }));
      state.savedReports = state.savedReports.filter((saved) => String(saved.report_id) !== String(reportId));
      if (String(state.saved?.report_id) === String(reportId)) state.saved = null;
      renderSaved();
    } catch (error) {
      showError(1, error.message);
      button.disabled = false;
    }
  }

  // A shared template (.mgrt) becomes a report in My reports, filled with this school's data.
  async function importTemplate(file) {
    const button = $("#rb-import");
    showError(1);
    if (!file) return;
    if (file.size > 200 * 1024) return showError(1, "That file is too large to be a report template.");
    button.disabled = true;
    const say = (message) => { $("#rb-import-status").textContent = message; };
    say("Importing…");
    try {
      let template;
      try { template = JSON.parse(await file.text()); } catch (_error) { throw new Error("This isn't a Managira report template (.mgrt) file."); }
      const result = await responseJson(await sendJson("/common/report-builder/import", { template }));
      upsertSaved({ ...result.report, is_owner: true });
      const skipped = result.skipped || [];
      say(skipped.length
        ? `Added “${result.report.report_name}” to My reports. Not in your school, so left out: ${skipped.join("; ")}.`
        : `Added “${result.report.report_name}” to My reports.`);
    } catch (error) {
      say("");
      showError(1, error.message);
    } finally {
      button.disabled = false;
      $("#rb-import-file").value = "";
    }
  }

  // ---- Events -----------------------------------------------------------------

  root.addEventListener("click", (event) => {
    if (event.target.classList?.contains("rb-modal")) return closeModal();
    const target = event.target.closest("a[data-family], a[data-load-saved], a[data-add-column], a[data-add-criterion], button");
    if (!target) return;
    if (target.tagName === "A") event.preventDefault();
    if (target.disabled) return;
    const { dataset } = target;
    if (dataset.closeModal !== undefined) return closeModal();
    if (dataset.openModal) return openModal(dataset.openModal, dataset.reportId || null);
    if (dataset.family) {
      const family = families.get(dataset.family);
      // Keep the current view when the same entry is picked again.
      return selectType(family.views.includes(state.reportType) ? state.reportType : family.views[0]);
    }
    if (dataset.view) return switchView(dataset.view);
    if (dataset.loadSaved) return openSaved(dataset.loadSaved);
    if (dataset.editSaved) return openSaved(dataset.editSaved, { edit: true });
    if (dataset.favoriteSaved) return toggleFavorite(dataset.favoriteSaved, target);
    if (dataset.deleteSaved) return deleteSaved(dataset.deleteSaved, target);
    if (dataset.stepNav) return goTo(Number(dataset.stepNav));
    if (dataset.nextStep) return goTo(Number(dataset.nextStep));
    if (dataset.previousStep) return goTo(Number(dataset.previousStep));
    if (dataset.foldAll) {
      // Expand every section of this list, or fold them all again.
      const current = report();
      const items = dataset.foldAll === "columns" ? current.columns : current.criteria;
      const names = [...new Set(items.map((item) => item.group).filter(Boolean))];
      const open = names.length && names.every((name) => openGroups.has(name));
      names.forEach((name) => (open ? openGroups.delete(name) : openGroups.add(name)));
      renderColumns();
      return renderCriteria();
    }
    if (dataset.toggleGroup) {
      if (openGroups.has(dataset.toggleGroup)) openGroups.delete(dataset.toggleGroup); else openGroups.add(dataset.toggleGroup);
      renderColumns();
      return renderCriteria();
    }
    if (dataset.addColumn) return changeColumns([...state.columns, dataset.addColumn]);
    if (dataset.removeColumn) return changeColumns(state.columns.filter((key) => key !== dataset.removeColumn));
    if (dataset.moveColumn) {
      const columns = [...state.columns];
      const index = columns.indexOf(dataset.moveColumn);
      const swap = index + Number(dataset.dir);
      [columns[index], columns[swap]] = [columns[swap], columns[index]];
      return changeColumns(columns);
    }
    if (dataset.addCriterion) {
      state.criteriaOrder.push(dataset.addCriterion);
      invalidate();
      renderCriteria();
      $("#rb-selected-criteria .rb-criterion:last-child")?.querySelector("input, select")?.focus();
      return;
    }
    if (dataset.removeCriterion) {
      state.criteriaOrder = state.criteriaOrder.filter((key) => key !== dataset.removeCriterion);
      delete state.criteria[dataset.removeCriterion];
      invalidate();
      return renderCriteria();
    }
    if (dataset.sortKey) {
      const same = state.sort?.key === dataset.sortKey;
      state.sort = { key: dataset.sortKey, dir: same && state.sort.dir === "asc" ? "desc" : "asc" };
      return runReport(1);
    }
    if (dataset.export) return exportReport(target);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  // Buttons that carry an icon next to their label.
  $$("[data-icon]").forEach((button) => button.prepend(icon(button.dataset.icon)));

  $("#rb-saved-filter").addEventListener("input", renderSaved);
  $("#rb-import").addEventListener("click", () => $("#rb-import-file").click());
  $("#rb-import-file").addEventListener("change", (event) => importTemplate(event.target.files[0]));
  $("#rb-column-search").addEventListener("input", renderColumns);
  $("#rb-criteria-search").addEventListener("input", renderCriteria);
  $("#rb-reset-columns").addEventListener("click", () => { if (report()) changeColumns([...report().defaultColumns]); });
  $("#rb-clear-criteria").addEventListener("click", () => {
    state.criteria = {};
    state.criteriaOrder = [];
    invalidate();
    renderCriteria();
  });
  $("#rb-retry").addEventListener("click", () => runReport(state.lastRunPage || 1));
  $("#rb-prev").addEventListener("click", () => runReport(state.page - 1));
  $("#rb-next").addEventListener("click", () => runReport(state.page + 1));
  $("#rb-page-size").addEventListener("change", (event) => {
    state.pageSize = Number(event.target.value);
    runReport(1);
  });
  $("#rb-duplicate").addEventListener("click", () => submitSave("duplicate"));
  $("#rb-save-new").addEventListener("click", () => submitSave("new"));
  $("#rb-report-name").addEventListener("input", renderSaveWindow);
  modalNode("save").addEventListener("click", (event) => {
    const button = event.target.closest("[data-align]");
    if (!button) return;
    state.saveAlign = button.dataset.align;
    renderSaveWindow();
  });
  modalNode("save").addEventListener("change", (event) => { if (event.target.matches("[data-brand]")) renderSaveWindow(); });
  $("#rb-include-shared").addEventListener("change", updateScheduleFields);
  $("#rb-save-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitSave(ownsSaved() ? "update" : "new");
  });
  $("#rb-staff-filter").addEventListener("input", renderStaff);
  $("#rb-staff-list").addEventListener("change", (event) => {
    if (!event.target.matches("input[type=checkbox]")) return;
    if (event.target.checked) state.shareSelection.add(event.target.value);
    else state.shareSelection.delete(event.target.value);
  });
  $("#rb-save-shares").addEventListener("click", (event) => saveShares(event.currentTarget));
  $("#rb-frequency").addEventListener("change", updateScheduleFields);
  $("#rb-save-schedule").addEventListener("click", (event) => saveSchedule(event.currentTarget));
  $("#rb-start-over").addEventListener("click", () => {
    state.reportType = "";
    state.columns = [];
    state.criteria = {};
    state.criteriaOrder = [];
    state.sort = null;
    state.saved = null;
    state.branding = {};
    status("");
    markSelectedType();
    invalidate();
    goTo(1);
  });

  renderSaved();
  goTo(1);
  if (data.initialType && reportTypes.has(data.initialType)) {
    selectType(data.initialType);
    Object.entries(data.initialCriteria || {}).forEach(([key, value]) => {
      if (!report().criteria.some((criterion) => criterion.key === key)) return;
      if (!state.criteriaOrder.includes(key)) state.criteriaOrder.push(key);
      state.criteria[key] = [String(value)];
    });
    goTo(4);
  }
})();
