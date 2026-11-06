// Moves one school from one shard's database to another's, keeping every id.
//
// The copy happens inside one transaction on the destination and is checked row by row
// before it commits, so it either arrives whole or not at all. The school is only removed
// from the old shard after the directory points at the new one. A rehearsal does all of
// the copying and checking, then rolls back and touches nothing.
const { connectTo, ident, loadCatalog, schemaDifferences } = require("./catalog");
const { classifyTable, SHARED_PARENT_LINKS } = require("./schoolTables");

const BATCH = 250;
const PAUSE_MS = Number(process.env.SHARD_MOVE_PAUSE_MS || 6000);
const ALWAYS_CLEARED = { organizations: ["shard_move_state"], managira_hubs: ["shard_move_state"] };

class MoveRefused extends Error {}

// ---- The plan: which tables, in what order, and how to read each one -----------------
function buildPlan(catalog, { withHub = false } = {}) {
  const unknown = [];
  const school = new Map();
  catalog.tables.forEach((table, name) => {
    const kind = classifyTable(name, table.columns.map((column) => column.name), { withHub });
    if (!kind) unknown.push(name);
    else if (kind.kind === "school") school.set(name, kind);
  });
  // Every written link must name columns that really exist.
  const linkProblems = [];
  school.forEach(({ where }, name) => {
    if (!where.parentColumns) return;
    const parent = catalog.tables.get(where.parent);
    const child = catalog.tables.get(name);
    const missing = !parent ? [where.parent]
      : where.parentColumns.filter((column) => !parent.columns.some((c) => c.name === column));
    if (!child.columns.some((c) => c.name === where.column)) missing.push(`${name}.${where.column}`);
    if (missing.length) linkProblems.push(`${name} links to ${where.parent} through ${missing.join(", ")}, which doesn't exist.`);
  });
  const links = catalog.foreignKeys.filter((fk) => school.has(fk.child) && school.has(fk.parent));
  const order = loadOrder([...school.keys()], links, school);
  const position = new Map(order.map((name, index) => [name, index]));

  // A link back to a table copied later (or to its own table) is filled in afterwards.
  const deferred = links.filter((fk) => fk.child === fk.parent || position.get(fk.parent) > position.get(fk.child));
  const problems = [...linkProblems, ...unknown.map((name) => `Nobody has decided whether ${name} belongs to a school. Add it to utils/shards/schoolTables.js.`)];
  deferred.filter((fk) => fk.required).forEach((fk) => problems.push(`${fk.child}.${fk.columns.join(",")} needs ${fk.parent} first, and ${fk.parent} needs it first.`));
  deferred.forEach((fk) => {
    if (!catalog.tables.get(fk.child).primaryKey.length) problems.push(`${fk.child} has no primary key, so its link to ${fk.parent} can't be filled in.`);
  });

  // The rows that really move: those whose required links stay inside the school. A few
  // links point at rows every shard has, and those never hold a row back.
  const staysInside = (fk) => !SHARED_PARENT_LINKS.has(`${fk.child}.${fk.columns[0]}`);
  const memo = new Map();
  const whereFor = (name) => {
    if (memo.has(name)) return memo.get(name);
    memo.set(name, (alias) => school.get(name).where(alias));
    // Only parents copied earlier: a loop of required links is reported above, not followed.
    const required = links.filter((fk) => fk.child === name && fk.required && fk.child !== fk.parent && staysInside(fk) && position.get(fk.parent) < position.get(name));
    const where = (alias) => [school.get(name).where(alias), ...required.map((fk) => inParent(fk, alias, whereFor))].join(" AND ");
    memo.set(name, where);
    return where;
  };

  const tables = order.map((name) => {
    const table = catalog.tables.get(name);
    const optional = links.filter((fk) => fk.child === name && !fk.required && staysInside(fk));
    const cleared = ALWAYS_CLEARED[name] || [];
    const parts = table.columns.map(({ name: column }) => {
      const quoted = ident(column);
      if (cleared.includes(column)) return { column, sql: `NULL AS ${quoted}` };
      const fk = optional.find((link) => link.columns.includes(column));
      // Pointing outside the school (say, at a platform admin who created it): cleared.
      return { column, sql: fk ? `CASE WHEN ${inParent(fk, "t", whereFor)} THEN t.${quoted} END AS ${quoted}` : `t.${quoted}` };
    });
    const destinationProjection = table.columns.map(({ name: column }) => `t.${ident(column)}`).join(", ");
    return {
      name,
      columns: table.columns.map((column) => column.name),
      primaryKey: table.primaryKey,
      triggers: table.triggers,
      where: whereFor(name)("t"),
      baseWhere: school.get(name).where("t"),
      parts,
      projection: parts.map((part) => part.sql).join(", "),
      destinationProjection,
      deferred: [...new Set(deferred.filter((fk) => fk.child === name).flatMap((fk) => fk.columns))],
      optionalLinks: optional,
    };
  });
  const inbound = catalog.foreignKeys.filter((fk) => school.has(fk.parent));
  return { tables, problems, school, whereFor, links, deferred, inbound };
}

function inParent(fk, alias, whereFor) {
  const childColumns = fk.columns.map((column) => `${alias}.${ident(column)}`);
  const parentColumns = fk.parent_columns.map(ident).join(", ");
  const left = childColumns.length > 1 ? `(${childColumns.join(", ")})` : childColumns[0];
  return `${left} IN (SELECT ${parentColumns} FROM ${ident(fk.parent)} p${fk.child === fk.parent ? "s" : ""} WHERE ${whereFor(fk.parent)(`p${fk.child === fk.parent ? "s" : ""}`)})`;
}

// Groups tables that reach each other through links: a group of more than one is a loop.
function findLoops(names, edges) {
  const parents = new Map(names.map((name) => [name, []]));
  edges.forEach((edge) => parents.get(edge.child).push(edge.parent));
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const groupOf = new Map();
  let counter = 0;
  const visit = (name) => {
    index.set(name, counter);
    low.set(name, counter);
    counter += 1;
    stack.push(name);
    onStack.add(name);
    parents.get(name).forEach((parent) => {
      if (!index.has(parent)) {
        visit(parent);
        low.set(name, Math.min(low.get(name), low.get(parent)));
      } else if (onStack.has(parent)) {
        low.set(name, Math.min(low.get(name), index.get(parent)));
      }
    });
    if (low.get(name) === index.get(name)) {
      for (;;) {
        const member = stack.pop();
        onStack.delete(member);
        groupOf.set(member, name);
        if (member === name) break;
      }
    }
  };
  names.forEach((name) => { if (!index.has(name)) visit(name); });
  return groupOf;
}

// Parents before children. Only a true loop breaks that rule, and then only by the fewest
// optional links, so as few rows as possible are filled in afterwards.
function loadOrder(names, links, school) {
  const sorted = [...names].sort();
  const edges = links.filter((fk) => fk.child !== fk.parent).map((fk) => ({ child: fk.child, parent: fk.parent, required: fk.required }));
  sorted.forEach((name) => {
    [].concat(school.get(name).parent || []).forEach((parent) => {
      if (school.has(parent) && parent !== name) edges.push({ child: name, parent, required: true });
    });
  });
  const groupOf = findLoops(sorted, edges);
  const placed = new Set();
  const order = [];
  const place = (name) => { placed.add(name); order.push(name); };
  const unplacedParents = (name, filter = () => true) => edges.filter((edge) => edge.child === name && !placed.has(edge.parent) && filter(edge));
  const childrenOf = (name) => edges.filter((edge) => edge.parent === name).length;
  while (order.length < sorted.length) {
    const ready = sorted.find((name) => !placed.has(name) && !unplacedParents(name).length);
    if (ready) { place(ready); continue; }
    // A loop that isn't waiting on anything outside itself.
    const waitingOutside = (name) => unplacedParents(name, (edge) => groupOf.get(edge.parent) !== groupOf.get(name)).length > 0;
    const groups = new Map();
    sorted.filter((name) => !placed.has(name)).forEach((name) => {
      const group = groupOf.get(name);
      groups.set(group, [...(groups.get(group) || []), name]);
    });
    const members = [...groups.values()].find((group) => !group.some(waitingOutside)) || [...groups.values()][0];
    const eligible = members.filter((name) => !unplacedParents(name, (edge) => edge.required).length);
    const next = (eligible.length ? eligible : members)
      .map((name) => ({ name, waiting: unplacedParents(name).length, children: childrenOf(name) }))
      .sort((x, y) => x.waiting - y.waiting || y.children - x.children || x.name.localeCompare(y.name))[0];
    place(next.name);
  }
  return order;
}

// The ids are checked integers: cursors can't take bound values.
const withSchool = (sql, scope) => sql.replace(/\$1\b/g, scope.ids.join(", ")).replace(/\$2\b/g, String(scope.hubId ?? "NULL"));
const checksumSql = (projection, table, where) => `
  SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(('x' || SUBSTR(MD5(TO_JSONB(x)::text), 1, 15))::bit(60)::bigint), 0)::text AS sum
    FROM (SELECT ${projection} FROM ${ident(table)} t WHERE ${where}) x`;

// ---- Before anything happens ----------------------------------------------------------
async function checkMove(source, destination, plan, sourceCatalog, destinationCatalog, scope) {
  const problems = [...plan.problems];
  const schools = (await source.query(
    "SELECT organization_id, organization_name, hub_id FROM organizations WHERE organization_id = ANY($1::int[])",
    [scope.ids]
  )).rows;
  if (schools.length !== scope.ids.length) throw new MoveRefused("That school isn't on this shard.");
  if (schools.some((school) => (school.hub_id || null) !== scope.hubId)) problems.push("Schools in a hub move with their hub.");
  if (scope.hubId) {
    const members = await source.query("SELECT organization_id FROM organizations WHERE hub_id = $1", [scope.hubId]);
    if (members.rows.some((row) => !scope.ids.includes(row.organization_id))) problems.push("Every school in the hub moves with it.");
    const hubThere = await destination.query("SELECT 1 FROM managira_hubs WHERE hub_id = $1", [scope.hubId]);
    if (hubThere.rows.length) problems.push("The destination already has this hub.");
  }
  const already = await destination.query("SELECT 1 FROM organizations WHERE organization_id = ANY($1::int[])", [scope.ids]);
  if (already.rows.length) problems.push("The destination already has a copy of this school.");
  problems.push(...schemaDifferences(sourceCatalog, destinationCatalog, plan.tables.map((table) => table.name)));
  return { schools, problems };
}

// ---- Copying --------------------------------------------------------------------------
async function copyRows(source, destination, table, scope) {
  const cursor = withSchool(`SELECT ROW_TO_JSON(x)::text AS row FROM (SELECT ${table.projection} FROM ${ident(table.name)} t WHERE ${table.where}) x`, scope);
  await source.query(`DECLARE move_rows NO SCROLL CURSOR FOR ${cursor}`);
  const columnList = table.columns.map(ident).join(", ");
  const selected = table.columns.map((column) => (table.deferred.includes(column) ? `NULL AS ${ident(column)}` : ident(column))).join(", ");
  const insert = `INSERT INTO ${ident(table.name)} (${columnList}) SELECT ${selected} FROM JSON_POPULATE_RECORDSET(NULL::${ident(table.name)}, $1::json)`;
  let copied = 0;
  for (;;) {
    const { rows } = await source.query(`FETCH ${BATCH} FROM move_rows`);
    if (!rows.length) break;
    await destination.query(insert, [`[${rows.map((row) => row.row).join(",")}]`]);
    copied += rows.length;
    if (rows.length < BATCH) break;
  }
  await source.query("CLOSE move_rows");
  return copied;
}

async function fillDeferred(source, destination, table, scope) {
  if (!table.deferred.length) return;
  const keep = [...new Set([...table.primaryKey, ...table.deferred])];
  const projected = table.parts.filter((part) => keep.includes(part.column)).map((part) => part.sql);
  const anyValue = table.deferred.map((column) => `x.${ident(column)} IS NOT NULL`).join(" OR ");
  const cursor = withSchool(`SELECT ROW_TO_JSON(x)::text AS row FROM (SELECT ${projected.join(", ")} FROM ${ident(table.name)} t WHERE ${table.where}) x WHERE ${anyValue}`, scope);
  await source.query(`DECLARE move_links NO SCROLL CURSOR FOR ${cursor}`);
  const assignments = table.deferred.map((column) => `${ident(column)} = v.${ident(column)}`).join(", ");
  const match = table.primaryKey.map((column) => `t.${ident(column)} = v.${ident(column)}`).join(" AND ");
  for (;;) {
    const { rows } = await source.query(`FETCH ${BATCH} FROM move_links`);
    if (!rows.length) break;
    await destination.query(
      `UPDATE ${ident(table.name)} t SET ${assignments} FROM JSON_POPULATE_RECORDSET(NULL::${ident(table.name)}, $1::json) v WHERE ${match}`,
      [`[${rows.map((row) => row.row).join(",")}]`]
    );
    if (rows.length < BATCH) break;
  }
  await source.query("CLOSE move_links");
}

// Triggers would rewrite rows and add new ones while a school arrives. Inside the
// transaction, so they are back on the moment it ends, however it ends.
async function setTriggers(client, tables, action) {
  for (const table of tables) {
    for (const trigger of table.triggers) {
      await client.query(`ALTER TABLE ${ident(table.name)} ${action} TRIGGER ${ident(trigger)}`);
    }
  }
}

// Every row must arrive exactly as it left.
async function verifyCopy(source, destination, tables, scope) {
  const report = [];
  for (const table of tables) {
    const [from, to] = await Promise.all([
      source.query(withSchool(checksumSql(table.projection, table.name, table.where), scope)),
      destination.query(withSchool(checksumSql(table.destinationProjection, table.name, table.baseWhere), scope)),
    ]);
    if (from.rows[0].rows !== to.rows[0].rows || from.rows[0].sum !== to.rows[0].sum) {
      throw new Error(`${table.name} didn't arrive intact: ${from.rows[0].rows} rows there, ${to.rows[0].rows} here.`);
    }
    if (Number(from.rows[0].rows)) report.push({ table: table.name, rows: Number(from.rows[0].rows) });
  }
  return report;
}

// Anything that changed on the old shard while copying (a webhook, a scheduled job) would
// be lost, so a change here stops the move and the school simply carries on where it was.
async function nothingChangedSince(sourceUrl, tables, report, scope) {
  const fresh = connectTo(sourceUrl);
  await fresh.connect();
  try {
    const counted = new Map(report.map((row) => [row.table, row.rows]));
    for (const table of tables) {
      const { rows } = await fresh.query(withSchool(`SELECT COUNT(*)::int AS n FROM ${ident(table.name)} t WHERE ${table.where}`, scope));
      if (rows[0].n !== (counted.get(table.name) || 0)) {
        throw new Error(`${table.name} changed while the school was being copied. Nothing was moved. Try again.`);
      }
    }
  } finally {
    await fresh.end().catch(() => {});
  }
}

// What won't come along: rows tied to people or records outside this school.
async function leftBehind(source, plan, scope) {
  const notes = [];
  for (const table of plan.tables) {
    if (table.where !== table.baseWhere) {
      const { rows } = await source.query(withSchool(`SELECT COUNT(*)::int AS n FROM ${ident(table.name)} t WHERE (${table.baseWhere}) AND NOT (${table.where})`, scope));
      if (rows[0].n) notes.push({ table: table.name, rows: rows[0].n, what: "stays behind: it depends on a record outside this school" });
    }
    for (const fk of table.optionalLinks) {
      const column = ident(fk.columns[0]);
      const { rows } = await source.query(withSchool(`SELECT COUNT(*)::int AS n FROM ${ident(table.name)} t WHERE (${table.where}) AND t.${column} IS NOT NULL AND NOT (${inParent(fk, "t", plan.whereFor)})`, scope));
      if (rows[0].n) notes.push({ table: table.name, rows: rows[0].n, what: `${fk.columns[0]} is cleared: it points outside this school` });
    }
  }
  return notes;
}

// ---- Removing the old copy ------------------------------------------------------------
async function removeSchool(client, plan, scope) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '20s'");
    await setTriggers(client, plan.tables, "DISABLE");
    const inSchool = (table) => withSchool(plan.school.get(table).where("t"), scope);
    const clear = async (fk, onlyOutside) => {
      // organization_id is part of what other links rely on: it's never blanked.
      const columns = fk.columns.filter((column) => column !== "organization_id");
      if (!columns.length) return;
      const assignments = columns.map((column) => `${ident(column)} = NULL`).join(", ");
      const pointsHere = withSchool(inParent(fk, "t", (name) => (alias) => plan.school.get(name).where(alias)), scope);
      const outside = onlyOutside && plan.school.has(fk.child) ? ` AND NOT (${inSchool(fk.child)})` : "";
      await client.query(`UPDATE ${ident(fk.child)} t SET ${assignments} WHERE ${pointsHere}${outside}`);
    };
    // Loops are untied first, and rows elsewhere that point at this school let go.
    for (const fk of plan.deferred) await clear(fk, false);
    for (const fk of plan.inbound) {
      if (!fk.required && !plan.deferred.includes(fk)) await clear(fk, true);
    }
    for (const table of [...plan.tables].reverse()) {
      await client.query(`DELETE FROM ${ident(table.name)} t WHERE ${inSchool(table.name)}`);
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await setTriggers(client, plan.tables, "ENABLE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// ---- The whole move -------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setMoveState(client, scope, state, only = null) {
  const onlyThese = only ? " AND shard_move_state = $3" : "";
  const values = only ? [state, scope.ids, only] : [state, scope.ids];
  await client.query(`UPDATE organizations SET shard_move_state = $1 WHERE organization_id = ANY($2::int[])${onlyThese}`, values);
  if (scope.hubId) await client.query(`UPDATE managira_hubs SET shard_move_state = $1 WHERE hub_id = ANY($2::int[])${onlyThese}`, only ? [state, [scope.hubId], only] : [state, [scope.hubId]]);
}

async function moveSchool({ organizationIds, hubId = null, sourceUrl, destinationUrl, rehearsal = false, onStep = () => {}, repoint = async () => {} }) {
  const ids = [...new Set((organizationIds || []).map(Number))];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new MoveRefused("Choose a school.");
  if (hubId !== null && !Number.isInteger(hubId)) throw new MoveRefused("Choose a hub.");
  const scope = { ids, hubId };
  const startedAt = Date.now();
  const source = connectTo(sourceUrl);
  const destination = connectTo(destinationUrl);
  let paused = false;
  let copyOpen = false;
  await source.connect();
  await destination.connect();
  try {
    for (const client of [source, destination]) {
      await client.query("SET statement_timeout = 0");
      await client.query("SET TIME ZONE 'UTC'");
    }
    await onStep("Checking both shards");
    const [sourceCatalog, destinationCatalog] = await Promise.all([loadCatalog(source), loadCatalog(destination)]);
    const plan = buildPlan(sourceCatalog, { withHub: Boolean(hubId) });
    const { schools, problems } = await checkMove(source, destination, plan, sourceCatalog, destinationCatalog, scope);
    if (problems.length) throw new MoveRefused(problems.slice(0, 6).join(" "));
    const notes = await leftBehind(source, plan, scope);

    if (!rehearsal) {
      await onStep("Pausing");
      await setMoveState(source, scope, "moving");
      paused = true;
      await sleep(PAUSE_MS);
    }

    await onStep("Copying");
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await destination.query("BEGIN");
    copyOpen = true;
    await destination.query("SET LOCAL lock_timeout = '20s'");
    await setTriggers(destination, plan.tables, "DISABLE");
    let rows = 0;
    for (const table of plan.tables) rows += await copyRows(source, destination, table, scope);
    for (const table of plan.tables) await fillDeferred(source, destination, table, scope);
    await destination.query("SET CONSTRAINTS ALL IMMEDIATE");

    await onStep(`Checking ${rows.toLocaleString("en-US")} rows`);
    const report = await verifyCopy(source, destination, plan.tables, scope);
    if (!rehearsal) await nothingChangedSince(sourceUrl, plan.tables, report, scope);
    await setTriggers(destination, plan.tables, "ENABLE");

    const summary = { schools: schools.map((school) => school.organization_name), rows, tables: report.length, notes, seconds: 0 };
    if (rehearsal) {
      await destination.query("ROLLBACK");
      await source.query("ROLLBACK");
      copyOpen = false;
      summary.seconds = Math.round((Date.now() - startedAt) / 1000);
      await onStep("Test passed. Nothing changed.");
      return summary;
    }

    await destination.query("COMMIT");
    await source.query("ROLLBACK");
    copyOpen = false;

    await onStep("Sending traffic to the new shard");
    try {
      await repoint();
    } catch (error) {
      // The old copy is still the real one: take the new one back out.
      await removeSchool(destination, plan, scope).catch(() => {});
      throw error;
    }
    paused = false; // From here the school lives on the new shard, whatever happens next.

    await onStep("Removing the old copy");
    await setMoveState(source, scope, "moved");
    for (const id of ids) {
      await source.query("DELETE FROM user_sessions WHERE (sess::jsonb)->>'organizationId' = $1", [String(id)]).catch(() => {});
    }
    if (hubId) await source.query("DELETE FROM user_sessions WHERE (sess::jsonb)->>'hubId' = $1", [String(hubId)]).catch(() => {});
    try {
      await removeSchool(source, plan, scope);
    } catch (error) {
      summary.cleanupError = error.message;
    }
    summary.seconds = Math.round((Date.now() - startedAt) / 1000);
    await onStep(summary.cleanupError ? "Moved. Old copy left." : "Done");
    return summary;
  } catch (error) {
    if (copyOpen) {
      await destination.query("ROLLBACK").catch(() => {});
      await source.query("ROLLBACK").catch(() => {});
    }
    if (paused) await setMoveState(source, scope, null).catch(() => {});
    throw error;
  } finally {
    await source.end().catch(() => {});
    await destination.end().catch(() => {});
  }
}

// The old copy couldn't be removed during the move: try again, on request.
async function retryRemoval({ organizationIds, hubId = null, sourceUrl }) {
  const source = connectTo(sourceUrl);
  await source.connect();
  try {
    await source.query("SET statement_timeout = 0");
    const catalog = await loadCatalog(source);
    await removeSchool(source, buildPlan(catalog, { withHub: Boolean(hubId) }), { ids: organizationIds.map(Number), hubId });
  } finally {
    await source.end().catch(() => {});
  }
}

module.exports = { moveSchool, retryRemoval, setMoveState, buildPlan, loadOrder, MoveRefused };
