# Shards

A shard is one app server and one database. Every school lives on exactly one. A small
router, `edge.js`, sends each request to the right shard, so school addresses never change.

```
                    managira.com, *.managira.com
                               |
                          edge.js (router)
              /            |            |             \
       us-shard-01    us-shard-02   af-shard-01   test-shard-01
       (control)
```

`us-shard-01` is the control shard: it holds the registry (`shards`), the directory
(`shard_schools`, `shard_hubs`), moves, releases, feature access and the audit log.
Admin pages live at `/admin/shards`, for super admins with a fresh password check.

## Going live, in order

Nothing changes for any school until step 6.

1. **Migrate, by name.**
   ```
   npm run migrate -- --only 2026-11-06_driver_reports_and_arrivals.sql
   npm run migrate -- --only 2026-11-07_shards.sql
   ```
   Don't run plain `npm run migrate` on `us-shard-01`: it has no history, and some older files
   were never applied there, so it would run all of them at once. New shards start with every
   file recorded as done.

2. **Secure the database login.**
   ```
   node scripts/secureDatabaseLogin.js          # shows what would change
   node scripts/secureDatabaseLogin.js --apply  # does it, and prints a new URL
   ```
   Put the new URL in `DB_CONNECTION_STRING` on Render. Keep the old one as
   `DB_ADMIN_CONNECTION_STRING` on your own machine only.

3. **Set on the main service.** `SHARD_SECRET` (`openssl rand -hex 32`),
   `SESSION_COOKIE_DOMAIN` left unset, `RENDER_API_KEY`, `RENDER_OWNER_ID`,
   `SHARD_REPO_URL`, `CONTROL_DB_EXTERNAL_URL` (the database's external URL).

4. **Stop pushes reaching production.** On `/admin/shards`, open `us-shard-01` and save its
   server address and Render service ID. That turns auto-deploy off for it.

5. **Deploy the router.** New > Blueprint on Render picks up `render.yaml`. Give it
   `CONTROL_DB_URL` and the same `SHARD_SECRET`. Check `/edge/health` on its Render address.

6. **Point the domain.** Move `managira.com` and `*.managira.com` to `managira-edge` on
   Render. With one shard everything still goes to `us-shard-01`.

7. **Create shards.** `/admin/shards` > Create shard. It builds the database, gives it its
   own id range, copies plans and prices, starts the server and checks it answers.

8. **Move schools.** Open the shard, press Move or Move hub, then **Test move**, then
   **Move now**.

## Releases

Production shards never deploy on a push.

1. Push to the test shard's branch. Only `test-shard-01` deploys.
2. Try it there, then Releases > **Add from test shard**.
3. **Approve**, tick the shards that should get it, and **Send**.
4. **Roll back** returns a shard to the version it had.

A shard you don't tick keeps its exact code. Its schools see no change at all.

Database migrations run on each shard as it deploys, and must only add things: a shard on an
older version shares nothing with the others, but a rollback does not undo a migration.

## Choosing schools inside a shard

One server runs one version, so limiting something to some schools on a shard takes a
switch. Add the feature to `utils/shards/features.js`, wrap it, and choose Off, Selected or
Everyone at `/admin/shards/features`:

```js
const { isOn } = require("./utils/shards/features");
if (isOn("my_feature", { organizationId })) { ... }
```

To give selected schools a whole release instead, move them to a shard that has it.

## How a move works

1. Refuses if a table is unclassified, the shards' structures differ, or the destination
   already has the school. A hub always moves with all its schools.
2. Pauses the school: its people see a short "one moment" page. Others are untouched.
3. Copies everything in one transaction, keeping every id.
4. Compares every table by row count and checksum. Any difference undoes the copy.
5. Stops if anything changed on the old shard during the copy.
6. Points the directory at the new shard, then removes the old copy.

Everyone in that school signs in again. To undo, move it back: ids are kept, so it is safe.

Every table must be classified in `utils/shards/schoolTables.js`. A table with
`organization_id` belongs to the school automatically; anything else must be listed, or every
move stops until it is. Write links with `via(...)`, which fails loudly on a wrong column.

## Limits

- A shard runs one server. A second one needs live bus positions and caches moved to Redis.
- Ids: each shard has a block of 100 million. Blocks 1 to 18 are for production and 19 and 20
  for testing. More shards than that needs ids widened first.
- Admin dashboards list the schools on their own shard. Use Open admin on a shard's page.
- Moves run best in quiet hours: writing to a shard's tables waits while a school arrives.
- Moved files stay in the shared S3 bucket.

## The sandbox shard

`sandbox-shard` shares the main shard's database. Moving a school or hub onto it changes only the directory: no rows are copied or removed, and `moveSchool` refuses to run between two shards on one database.

New features start on the sandbox. Add each one to `utils/shards/features.js` with `access: "selected"` and wrap it with `isOn`. Schools on the sandbox shard get it as soon as it is pushed. From `/admin/shards/features` it can then go to other shards, hubs and schools, or to everyone.

While every shard runs on one Render service, this limits what people see, not which code runs. To keep the code itself off the other shards:

1. Create a second Render service from this repo on branch `main`, with the same environment as production, plus `SHARD_NAME=sandbox-shard`. Add its address to the shard on its admin page.
2. Point the production service at a `production` branch, with auto-deploy off.
3. Deploy the router (`managira-edge`) and point the domain at it, so sandbox schools reach the new service.
