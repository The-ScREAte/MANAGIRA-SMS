(() => {
  const root = document.querySelector('.report-builder-page');
  if (!root || root.dataset.rbInitialized === '1') return;
  root.dataset.rbInitialized = '1';
  const data = window.reportBuilderData || {};
  const reportTypes = new Map((data.reportTypes || []).map((report) => [report.key, report]));
  const state = {
    step: 1,
    reportType: "",
    columns: [],
    criteria: {},
    page: 0,
    total: 0,
    hasRun: false,
    running: false,
    resultRequest: null,
    saving: false,
    criteriaVisited: false,
  };

  const $ = (selector, scope = root) => scope.querySelector(selector);
  const $$ = (selector, scope = root) => [...scope.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "");

  function showError(step, message = "") {
    const target = $(`[data-error-for="${step}"]`);
    if (target) target.textContent = message;
  }

  function getCurrentReport() {
    return reportTypes.get(state.reportType);
  }

  function readCriteria() {
    return {
      search: $("#rb-search").value.trim(),
      classId: $("#rb-class").value,
      termId: $("#rb-term").value,
      fromDate: $("#rb-from-date").value,
      toDate: $("#rb-to-date").value,
    };
  }

  function invalidateReport() {
    state.hasRun = false;
    state.resultRequest = null;
    state.page = 0;
    state.total = 0;
    $("#rb-next-save").disabled = true;
    $("#rb-results-status").classList.remove("is-error");
    $("#rb-results-status").textContent = "Your setup changed. Run the report again to refresh the results.";
    $("#rb-table-wrap").hidden = true;
    $("#rb-load-more-wrap").hidden = true;
    updateStepper(state.step);
  }

  function renderColumns() {
    const report = getCurrentReport();
    const list = $("#rb-column-list");
    const continueButton = $("[data-next-step='3']");
    list.replaceChildren();
    if (!report || !Array.isArray(report.columns) || !report.columns.length) {
      showError(2, "No columns are configured for this report.");
      continueButton.disabled = true;
      return false;
    }

    report.columns.forEach((column) => {
      const label = document.createElement("label");
      label.className = "rb-column-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = column.key;
      checkbox.checked = state.columns.includes(column.key);
      checkbox.addEventListener("change", () => {
        state.columns = $$("#rb-column-list input:checked").map((input) => input.value);
        continueButton.disabled = !state.columns.length;
        showError(2, state.columns.length ? "" : "Choose at least one column.");
        updateColumnSelection();
        invalidateReport();
      });
      const text = document.createElement("span");
      text.textContent = column.label;
      label.append(checkbox, text);
      list.append(label);
    });

    $("#rb-selected-report-label").textContent = report.title;
    $("#rb-criteria-report-label").textContent = report.title;
    $("#rb-search-label").textContent = report.searchLabel || "Search";
    $("#rb-class-field").hidden = !report.hasClassFilter;
    $("#rb-term-field").hidden = !report.hasTermFilter;
    $("#rb-from-date-field").hidden = !report.hasDateFilter;
    $("#rb-to-date-field").hidden = !report.hasDateFilter;
    continueButton.disabled = !state.columns.length;
    updateColumnSelection();
    showError(2);
    return true;
  }

  function updateColumnSelection() {
    const query = $("#rb-column-search").value.trim().toLowerCase();
    let visible = 0;
    $$(".rb-column-option").forEach((option) => {
      option.hidden = !option.textContent.toLowerCase().includes(query);
      if (!option.hidden) visible++;
    });
    $("#rb-column-count").textContent = `${state.columns.length} of ${getCurrentReport()?.columns.length || 0} selected`;
    $("#rb-no-columns").hidden = visible > 0;
  }

  function setReportType(reportType) {
    const report = reportTypes.get(reportType);
    if (!report) return;
    state.reportType = reportType;
    state.columns = [...report.defaultColumns];
    state.criteria = {};
    state.hasRun = false;
    state.resultRequest = null;
    state.criteriaVisited = false;
    state.page = 0;
    $$("#rb-report-types [data-report-type]").forEach((card) => {
      const selected = card.dataset.reportType === reportType;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    $("#rb-search").value = "";
    $("#rb-class").value = "";
    $("#rb-term").value = "";
    $("#rb-from-date").value = "";
    $("#rb-to-date").value = "";
    $("#rb-column-search").value = "";
    $("#rb-next-save").disabled = true;
    $("#rb-results-type").textContent = report.title;
    $("#rb-results-title").textContent = `${report.title} preview`;
    $("#rb-results-description").textContent = report.description;
    $("#rb-results-status").textContent = "Run your report to see the matching records.";
    $("#rb-table-wrap").hidden = true;
    $("#rb-load-more-wrap").hidden = true;
    renderColumns();
    updateStepper(state.step);
    showError(1);
    showError(2);
  }

  function updateStepper(step) {
    state.step = step;
    if (step === 3) state.criteriaVisited = true;
    $("[data-next-step='2']").disabled = !state.reportType || state.running;
    $$("[data-step-panel]").forEach((panel) => {
      panel.hidden = Number(panel.dataset.stepPanel) !== step;
    });
    $$("[data-step-nav]").forEach((button) => {
      const number = Number(button.dataset.stepNav);
      button.classList.toggle("is-current", number === step);
      button.classList.toggle("is-complete", number < step);
      if (number === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      const canVisit = number === 1
        || (number === 2 && Boolean(state.reportType))
        || (number === 3 && Boolean(state.reportType && state.columns.length))
        || (number === 4 && state.hasRun)
        || (number === 5 && state.hasRun);
      button.disabled = !canVisit || state.running;
    });
    $("#rb-run-report").disabled = !state.reportType || !state.columns.length || state.running;
  }

  function getRequestBody() {
    return {
      reportType: state.reportType,
      columns: state.columns,
      criteria: readCriteria(),
    };
  }

  async function responseJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.error || "Something went wrong. Please try again.");
    }
    return body;
  }

  function renderResults(columns, rows, append = false) {
    const head = $("#rb-table-head");
    const body = $("#rb-table-body");
    if (!append) {
      const row = document.createElement("tr");
      columns.forEach((column) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = column.label;
        row.append(th);
      });
      head.replaceChildren(row);
      body.replaceChildren();
    }

    rows.forEach((record) => {
      const row = document.createElement("tr");
      columns.forEach((column) => {
        const cell = document.createElement("td");
        const value = record[column.key];
        cell.textContent = value === null || value === undefined || value === "" ? "—" : esc(value);
        row.append(cell);
      });
      body.append(row);
    });
  }

  async function runReport({ append = false } = {}) {
    if (!state.reportType || !state.columns.length || state.running) return;
    if (append && !state.hasRun) return;
    const criteria = readCriteria();
    if (criteria.fromDate && criteria.toDate && criteria.fromDate > criteria.toDate) {
      showError(3, "The start date must be before the end date.");
      return;
    }
    state.running = true;
    updateStepper(4);
    $$("[data-previous-step], [data-next-step], #rb-load-more").forEach((button) => { button.disabled = true; });
    const request = append ? state.resultRequest : getRequestBody();
    if (!append) {
      state.hasRun = false;
      $("#rb-table-wrap").hidden = true;
      $("#rb-load-more-wrap").hidden = true;
    }
    showError(3);
    showError(4);
    const button = $("#rb-run-report");
    button.disabled = true;
    button.textContent = append ? "Loading…" : "Running…";
    $("#rb-results-status").classList.remove("is-error");
    $("#rb-results-status").textContent = append ? "Loading more rows…" : "Building your report…";
    try {
      const response = await fetch("/common/report-builder/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...request, page: append ? state.page + 1 : 1 }),
      });
      const result = await responseJson(response);
      state.page = result.page;
      state.total = result.total;
      state.hasRun = true;
      state.resultRequest = request;
      renderResults(result.columns, result.rows, append);
      $("#rb-table-wrap").hidden = false;
      $("#rb-next-save").disabled = false;
      $("#rb-results-status").textContent = result.total
        ? `Showing ${Math.min(result.page * result.pageSize, result.total).toLocaleString()} of ${result.total.toLocaleString()} matching records.`
        : "No records matched these criteria.";
      $("#rb-load-more-wrap").hidden = !result.hasMore;
      updateStepper(4);
      showError(4);
    } catch (error) {
      if (append) {
        showError(4, error.message);
      } else {
        state.hasRun = false;
        updateStepper(3);
        showError(3, error.message);
      }
    } finally {
      state.running = false;
      $$("[data-previous-step], [data-next-step], #rb-load-more").forEach((control) => { control.disabled = false; });
      $("#rb-next-save").disabled = !state.hasRun;
      updateStepper(state.step);
      button.textContent = "Run report";
    }
  }

  function appendSavedReport(saved) {
    const list = $("#rb-saved-list");
    $(".rb-empty-saved", list)?.remove();
    const item = document.createElement("article");
    item.className = "rb-saved-item";
    item.dataset.savedId = saved.report_id;
    const load = document.createElement("button");
    load.type = "button";
    load.className = "rb-saved-load";
    load.dataset.loadSaved = saved.report_id;
    const name = document.createElement("strong");
    name.textContent = saved.report_name;
    const type = document.createElement("span");
    type.textContent = reportTypes.get(saved.report_type)?.title || "Report";
    load.append(name, type);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rb-icon-button";
    remove.dataset.deleteSaved = saved.report_id;
    remove.setAttribute("aria-label", `Delete ${saved.report_name}`);
    remove.title = "Delete saved report";
    remove.textContent = "×";
    item.append(load, remove);
    list.prepend(item);
  }

  async function loadSavedReport(reportId) {
    try {
      const result = await responseJson(await fetch(`/common/report-builder/saved/${encodeURIComponent(reportId)}`, {
        headers: { Accept: "application/json" },
      }));
      const saved = result.report;
      if (!reportTypes.has(saved.report_type)) throw new Error("This saved report type is no longer available.");
      setReportType(saved.report_type);
      const savedColumns = Array.isArray(saved.columns_json) ? saved.columns_json : JSON.parse(saved.columns_json || "[]");
      state.columns = savedColumns.filter((key) => getCurrentReport().columns.some((column) => column.key === key));
      if (!state.columns.length) state.columns = [...getCurrentReport().defaultColumns];
      state.criteria = typeof saved.criteria_json === "object"
        ? saved.criteria_json
        : JSON.parse(saved.criteria_json || "{}");
      $("#rb-search").value = state.criteria.search || "";
      $("#rb-class").value = state.criteria.classId || "";
      $("#rb-term").value = state.criteria.termId || "";
      $("#rb-from-date").value = state.criteria.fromDate || "";
      $("#rb-to-date").value = state.criteria.toDate || "";
      $("#rb-report-name").value = saved.report_name || "";
      renderColumns();
      updateStepper(2);
    } catch (error) {
      showError(1, error.message);
    }
  }

  async function deleteSavedReport(reportId, button) {
    if (!window.confirm("Delete this saved report setup?")) return;
    button.disabled = true;
    try {
      await responseJson(await fetch(`/common/report-builder/saved/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      }));
      button.closest(".rb-saved-item")?.remove();
      if (!$("#rb-saved-list .rb-saved-item")) {
        const empty = document.createElement("p");
        empty.className = "rb-empty-saved";
        empty.textContent = "Your saved report setups will appear here.";
        $("#rb-saved-list").append(empty);
      }
    } catch (error) {
      showError(1, error.message);
      button.disabled = false;
    }
  }

  async function saveReport(event) {
    event.preventDefault();
    if (!state.hasRun || !state.resultRequest || state.saving) return;
    const name = $("#rb-report-name").value.trim();
    const status = $("#rb-save-status");
    status.textContent = "";
    if (!name) {
      status.textContent = "Enter a name for this saved report.";
      return;
    }
    state.saving = true;
    const button = $("#rb-save-form [type='submit']");
    button.disabled = true;
    try {
      const result = await responseJson(await fetch("/common/report-builder/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...state.resultRequest, name }),
      }));
      appendSavedReport(result.report);
      status.textContent = `"${result.report.report_name}" is saved and ready to reuse.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      state.saving = false;
      button.disabled = false;
    }
  }

  async function exportReport(button) {
    if (!state.hasRun || !state.resultRequest) return;
    const status = $("#rb-save-status");
    status.textContent = "";
    button.disabled = true;
    button.textContent = "Preparing CSV…";
    try {
      const response = await fetch("/common/report-builder/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/csv, application/json" },
        body: JSON.stringify(state.resultRequest),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Could not export this report.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${state.reportType.replace(/[^a-z0-9_-]/gi, "")}-report.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      status.textContent = "Your CSV download is ready.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Download CSV";
    }
  }

  $("#rb-report-types").addEventListener("click", (event) => {
    const card = event.target.closest("[data-report-type]");
    if (card) setReportType(card.dataset.reportType);
  });

  $("#rb-column-search").addEventListener("input", updateColumnSelection);
  $("#rb-columns-all").addEventListener("click", () => {
    if (!getCurrentReport()) return;
    state.columns = getCurrentReport().columns.map((column) => column.key);
    renderColumns();
    invalidateReport();
  });
  $("#rb-columns-default").addEventListener("click", () => {
    if (!getCurrentReport()) return;
    state.columns = [...getCurrentReport().defaultColumns];
    renderColumns();
    invalidateReport();
  });

  $$(".rb-step[data-step-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = Number(button.dataset.stepNav);
      if (!button.disabled) updateStepper(step);
    });
  });

  $$("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.nextStep);
      if (next === 2 && !state.reportType) {
        showError(1, "Select a report type to continue.");
        return;
      }
      if (next === 3 && !state.columns.length) {
        showError(2, "Choose at least one column.");
        return;
      }
      if (next === 2 && !renderColumns()) return;
      if (next === 5 && !state.hasRun) return;
      showError(state.step);
      updateStepper(next);
    });
  });

  $$("[data-previous-step]").forEach((button) => {
    button.addEventListener("click", () => updateStepper(Number(button.dataset.previousStep)));
  });

  ["#rb-search", "#rb-class", "#rb-term", "#rb-from-date", "#rb-to-date"].forEach((selector) => {
    $(selector).addEventListener("input", invalidateReport);
    $(selector).addEventListener("change", invalidateReport);
  });

  $("#rb-run-report").addEventListener("click", () => runReport());
  $("#rb-load-more").addEventListener("click", () => runReport({ append: true }));
  $("#rb-save-form").addEventListener("submit", saveReport);
  $("#rb-export-report").addEventListener("click", (event) => exportReport(event.currentTarget));
  $("#rb-start-over").addEventListener("click", () => {
    state.reportType = "";
    state.columns = [];
    state.criteria = {};
    state.hasRun = false;
    state.resultRequest = null;
    state.criteriaVisited = false;
    state.page = 0;
    state.total = 0;
    $("#rb-report-name").value = "";
    $$("#rb-report-types [data-report-type]").forEach((card) => {
      card.classList.remove("is-selected");
      card.setAttribute("aria-pressed", "false");
    });
    $("#rb-save-status").textContent = "";
    $("#rb-next-save").disabled = true;
    updateStepper(1);
  });

  $("#rb-saved-list").addEventListener("click", (event) => {
    const loadButton = event.target.closest("[data-load-saved]");
    if (loadButton) return loadSavedReport(loadButton.dataset.loadSaved);
    const deleteButton = event.target.closest("[data-delete-saved]");
    if (deleteButton) return deleteSavedReport(deleteButton.dataset.deleteSaved, deleteButton);
  });

  updateStepper(1);
})();
