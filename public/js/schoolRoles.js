// A school's own staff roles on Add user and Edit user (views/partials/schoolRoles.ejs,
// utils/schoolRoles.js). The Role select lists the built-in roles, the school's roles (each one's
// value is the built-in role it's based on) and "+ Add a role…", which opens a small box: a name
// and what it's based on. A new role is chosen at once and ticks its permissions; changing the
// ticks offers to save them to the role. Bound once; works after the page-switcher swaps pages.
(function () {
  "use strict";
  if (window.ManagiraSchoolRoles) { window.ManagiraSchoolRoles.scan(); return; }

  const last = new WeakMap();
  const dirty = new WeakMap();
  const isRoleSelect = (el) => el instanceof HTMLSelectElement && Boolean(el.querySelector("option[data-add-role]"));
  const scopeOf = (select) => select.closest("form") || document;
  const parts = (select) => {
    const scope = scopeOf(select);
    const box = scope.querySelector("[data-school-role-box]");
    const line = scope.querySelector("[data-school-role-line]");
    return { scope, box, line, input: scope.querySelector("[data-school-role-input]") };
  };
  const chosen = (select) => { const o = select.options[select.selectedIndex]; return o && o.dataset.roleId ? o : null; };
  const permissionsOf = (select) => {
    const o = chosen(select);
    if (!o) return null;
    try { return JSON.parse(o.dataset.permissions || "[]"); } catch (e) { return []; }
  };
  const ticked = (scope) => Array.from(scope.querySelectorAll('input[name="permissions"]:checked')).map((cb) => cb.value);
  const same = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

  function say(line, text) {
    const done = line && line.querySelector("[data-sr-done]");
    if (!done) return;
    done.textContent = text || "";
    done.hidden = !text;
  }
  function sync(select) {
    const { scope, line, input } = parts(select);
    const role = chosen(select);
    if (input) input.value = role ? role.dataset.roleId : "";
    if (!line) return;
    line.hidden = !role;
    if (!role) return;
    line.querySelector("[data-sr-about]").textContent = `${role.dataset.roleName} is based on ${role.value}.`;
    const changed = dirty.get(select) && !same(ticked(scope), permissionsOf(select) || []);
    line.querySelector("[data-sr-update]").hidden = !changed;
  }

  async function post(url, body) {
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await response.json().catch(() => null);
      return data || { error: "That didn't save. Try again." };
    } catch (e) {
      return { error: "That didn't save. Check your connection and try again." };
    }
  }

  function openBox(select) {
    const { box } = parts(select);
    if (!box) return;
    box.hidden = false;
    box._select = select;
    const base = box.querySelector("[data-sr-base]");
    if (base && Array.from(base.options).some((o) => o.value === select.value)) base.value = select.value;
    const error = box.querySelector("[data-sr-error]");
    if (error) error.hidden = true;
    const name = box.querySelector("[data-sr-name]");
    if (name) { name.value = ""; name.focus(); }
  }
  function closeBox(box) { if (box) box.hidden = true; }

  async function saveNew(box) {
    const select = box._select;
    if (!select) return;
    const name = box.querySelector("[data-sr-name]").value.trim();
    const baseType = box.querySelector("[data-sr-base]").value;
    const error = box.querySelector("[data-sr-error]");
    const button = box.querySelector("[data-sr-save]");
    if (name.length < 2) { error.textContent = "Give the role a name."; error.hidden = false; return; }
    // What's ticked now becomes the role's, when it's for the same built-in role; otherwise it
    // starts with that role's own.
    const { scope, line } = parts(select);
    const now = ticked(scope);
    const body = { name, baseType };
    if (select.value === baseType && now.length) body.permissions = now;
    button.disabled = true;
    const result = await post("/common/school-roles", body);
    button.disabled = false;
    if (!result.ok || !result.role) { error.textContent = result.error || "That didn't save. Try again."; error.hidden = false; return; }
    const role = result.role;
    let group = select.querySelector("optgroup[data-school-roles-group]");
    if (!group) {
      group = document.createElement("optgroup");
      group.label = "Your school's roles";
      group.setAttribute("data-school-roles-group", "");
      select.insertBefore(group, select.querySelector("option[data-add-role]"));
    }
    const option = document.createElement("option");
    option.value = role.base;
    option.textContent = role.name;
    option.dataset.roleId = String(role.id);
    option.dataset.roleName = role.name;
    option.dataset.permissions = JSON.stringify(role.permissions || []);
    const after = Array.from(group.children).find((o) => o.textContent.localeCompare(role.name, undefined, { sensitivity: "base" }) > 0);
    group.insertBefore(option, after || null);
    closeBox(box);
    option.selected = true;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    say(line, `${role.name} added.`);
  }

  async function saveTicks(select) {
    const role = chosen(select);
    if (!role) return;
    const { scope, line } = parts(select);
    const result = await post(`/common/school-roles/${role.dataset.roleId}`, { permissions: ticked(scope) });
    if (!result.ok || !result.role) { say(line, result.error || "That didn't save."); return; }
    role.dataset.permissions = JSON.stringify(result.role.permissions || []);
    dirty.set(select, false);
    sync(select);
    say(line, `Saved to ${role.dataset.roleName}.`);
  }

  async function removeRole(select) {
    const role = chosen(select);
    if (!role) return;
    const name = role.dataset.roleName;
    if (!window.confirm(`Remove the role "${name}"? Everyone with it keeps their access and shows as ${role.value}.`)) return;
    const { line } = parts(select);
    const result = await post(`/common/school-roles/${role.dataset.roleId}/remove`, {});
    if (!result.ok) { say(line, result.error || "That didn't remove."); return; }
    const base = Array.from(select.options).find((o) => o.value === role.value && !o.dataset.roleId && !o.hasAttribute("data-add-role"));
    const group = role.parentElement;
    role.remove();
    if (group && group.matches("optgroup[data-school-roles-group]") && !group.children.length) group.remove();
    // The person keeps the permissions ticked now; only the role's name goes.
    if (base) base.selected = true;
    last.set(select, select.selectedIndex);
    sync(select);
  }

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!isRoleSelect(select)) return;
    const option = select.options[select.selectedIndex];
    if (option && option.hasAttribute("data-add-role")) {
      // Not a role: put the last choice back, keep the form's own handlers out of it, open the box.
      event.stopImmediatePropagation();
      select.selectedIndex = last.has(select) ? last.get(select) : 0;
      openBox(select);
      return;
    }
    last.set(select, select.selectedIndex);
    dirty.set(select, false);
    say(parts(select).line, "");
    setTimeout(() => sync(select), 0);
  }, true);

  document.addEventListener("change", (event) => {
    if (!event.target.matches || !event.target.matches('input[name="permissions"]')) return;
    const form = event.target.closest("form") || document;
    const select = Array.from(form.querySelectorAll("select")).find(isRoleSelect);
    if (!select) return;
    dirty.set(select, true);
    say(parts(select).line, "");
    sync(select);
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest && event.target.closest("[data-sr-save], [data-sr-cancel], [data-sr-update], [data-sr-remove]");
    if (!target) return;
    event.preventDefault();
    const box = target.closest("[data-school-role-box]");
    if (target.matches("[data-sr-save]")) return saveNew(box);
    if (target.matches("[data-sr-cancel]")) return closeBox(box);
    const form = target.closest("form") || document;
    const select = Array.from(form.querySelectorAll("select")).find(isRoleSelect);
    if (!select) return;
    if (target.matches("[data-sr-update]")) return saveTicks(select);
    return removeRole(select);
  });

  // Enter in the name box adds the role (it never sends the staff form); Escape closes it.
  document.addEventListener("keydown", (event) => {
    const input = event.target.closest && event.target.closest("[data-school-role-box] input, [data-school-role-box] select");
    if (!input) return;
    const box = input.closest("[data-school-role-box]");
    if (event.key === "Enter") { event.preventDefault(); saveNew(box); }
    if (event.key === "Escape") { event.preventDefault(); closeBox(box); }
  });

  function scan() {
    document.querySelectorAll("select").forEach((select) => {
      if (!isRoleSelect(select)) return;
      last.set(select, select.selectedIndex);
      sync(select);
    });
  }
  window.ManagiraSchoolRoles = { scan, permissionsOf };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan, { once: true });
  else scan();
})();
