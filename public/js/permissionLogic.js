// The staff permissions screen's rules, kept apart from the page so tests can run them
// (tests/permissionBasics.test.js) and the page (views/partials/permissionPicker.ejs) uses the
// same code. Nothing here stores or checks a permission: it works out what the screen shows.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ManagiraPermissionLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const unique = (list) => Array.from(new Set(list));

  // What someone holds beyond the role's basics, counted once per thing: a follow-up of an
  // extra permission is part of it, not another extra.
  function extraKeys(held, basics, parentOf = {}) {
    const base = new Set(basics);
    const extra = new Set(held.filter((key) => !base.has(key)));
    return Array.from(extra).filter((key) => !parentOf[key] || !extra.has(parentOf[key]));
  }

  // Changing the role: the new role's basics, plus whatever was added beyond the old role's
  // basics. Nothing else changes. `turnedOff` is told to the person before they switch.
  //   toDriver     the new role is Driver: only driving and transportation permissions can be held.
  function switchRole({ held, oldBasics, newBasics, data, toDriver = false }) {
    const before = unique(held);
    const base = new Set(oldBasics || []);
    const extras = before.filter((key) => !base.has(key));
    let next = new Set([...newBasics, ...extras]);
    const parentOf = data.parentOf || {};
    const driverKeys = new Set(data.driverKeys || []);
    const driverOnly = new Set(data.driverOnly || []);
    next = new Set(Array.from(next).filter((key) => (toDriver ? driverKeys.has(key) : !driverOnly.has(key))));
    // Users / Employees stays with a driver only while they lead.
    if (toDriver && !next.has("driver_lead")) {
      next = new Set(Array.from(next).filter((key) => key !== "manage_employees" && parentOf[key] !== "manage_employees"));
    }
    // A follow-up is held only with its main permission.
    let changed = true;
    while (changed) {
      changed = false;
      for (const key of Array.from(next)) {
        if (parentOf[key] && !next.has(parentOf[key])) { next.delete(key); changed = true; }
      }
    }
    const nextList = Array.from(next);
    return {
      next: nextList,
      turnedOff: before.filter((key) => !next.has(key)),
      turnedOn: nextList.filter((key) => !before.includes(key)),
    };
  }

  return { extraKeys, switchRole };
});
