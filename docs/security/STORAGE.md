# File storage: private and in the United States

Managira keeps uploaded and generated files (report cards, transcripts, student and guardian
photos, signatures, form answers, sign-up documents, migration files) in Amazon S3. This page
describes how those files are protected and the one-time procedure that moves them from the
original bucket (`oneplaces3`, Ireland, eu-west-1) to a private bucket in the United States.

## How files are protected

- **Private by default.** The bucket policy lets anyone read only the pictures and videos of the
  public folders: school websites, school and hub logos, public dashboards, announcements,
  sign-in banners and help-center pictures (`utils/storedFiles.js` `PUBLIC_PREFIXES`,
  `PUBLIC_EXTENSIONS`). Everything else, including every file about a student, can be read only
  through a link Managira signs after checking who is asking.
- **Short-lived links.** A signed link works for 5 minutes (an hour on the email history page)
  and names one file. Pages never contain a storage address for a private file:
  - pictures go through `/public-image` (signed for the viewer's own session);
  - report cards through the parent's and student's own routes, which check the child is theirs
    and that the class shares report cards;
  - form answers, question help and parent resources through `/files/...`, which requires a
    signed-in person of the same school;
  - school sign-up documents and job applications through admin-only routes;
  - report cards sent by text through `/r/<code>` short links: 64 random bits, and links to
    student files stop working 90 days after they're made.
- **Encrypted** at rest (AES-256, SSE-C refused) and in transit: the policy refuses any request
  that isn't HTTPS.
- **No access control lists.** The bucket owner owns every file (`BucketOwnerEnforced`), and the
  public access block refuses ACLs, so a file can't be made public one at a time.
- **Browsers may only read**, and only from managira.com and its school sites (CORS).
- **Versioned** (the new bucket): a deleted or overwritten file can be recovered for 30 days.
- **File names can't be guessed.** New uploads carry a random part; sign-up documents have a
  private folder of their own (`school-signup/`).

The rules live in one place, `utils/storagePolicy.js`, used by both scripts below, and are
checked by `tests/storedFiles.test.js`.

## The move, step by step

Nothing below runs on its own. Each script shows what it would do and changes nothing unless it
is given `--apply`. Run them from a copy of Managira whose `.env` has the production AWS keys and
`DB_CONNECTION_STRING` (the scripts only read the database, to find the sign-in banners).

The AWS keys need, on both buckets: `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject`, `s3:GetBucketPolicy`, `s3:PutBucketPolicy`, `s3:GetBucketCORS` (the
`GetBucketCors` call), `s3:PutBucketCORS`, `s3:PutEncryptionConfiguration`,
`s3:PutBucketPublicAccessBlock`, `s3:GetBucketPublicAccessBlock`, and for the new bucket also
`s3:CreateBucket`, `s3:PutBucketVersioning`, `s3:PutLifecycleConfiguration`,
`s3:PutBucketOwnershipControls`.

### 1. Deploy the application

Deploy the version that opens every private file through signed links. It works with the bucket
as it is today, so this step changes nothing for anyone.

The privacy policy in this version states that student files are private and stored in the
United States. Finish steps 2 to 6 on the day of the deploy, so that statement is true from the
start.

### 2. Make the current bucket private

```
node scripts/s3PrivateFolders.js            # shows, per folder, what stays public and what turns private
node scripts/s3PrivateFolders.js --apply    # saves the current settings to s3-policy-backup-<bucket>-<time>.json, applies, checks
```

After applying, the script reads one public picture and one private file without credentials and
expects 200 and 403. Then check by hand: a school website, a student photo in the app, a parent
opening a report card, the sign-in page banner, and an emailed report card link.

To undo: `node scripts/s3PrivateFolders.js --restore s3-policy-backup-<bucket>-<time>.json`.
Keep that file until the move is finished; it isn't committed (`.gitignore`).

### 3. Copy everything to the United States

```
node scripts/s3MoveToUs.js --to <new-bucket> --region us-west-2            # what it would do
node scripts/s3MoveToUs.js --to <new-bucket> --region us-west-2 --apply    # make, set up and copy
```

`us-west-2` (Oregon) is where the database runs. The script makes the bucket with the settings
above, copies every file under the same name, and checks that every file arrived at the same
size. Run `--apply` again as often as needed; it copies only what is new or changed.

### 4. Switch the server

On Render, in the web service's and the worker's environment:

```
S3_BUCKET_NAME=<new-bucket>
AWS_REGION=us-west-2
S3_LEGACY_BUCKETS=oneplaces3
```

`S3_LEGACY_BUCKETS` makes every address stored before the move open the same file in the new
bucket, so nothing in the database needs to change.

### 5. Final copy

Right after the switch, copy what was uploaded in between:

```
node scripts/s3MoveToUs.js --from oneplaces3 --from-region eu-west-1 --to <new-bucket> --region us-west-2 --apply
```

### 6. Point stored addresses at the new bucket

Some pages and exports use a stored address as it is (sign-in banners, school website videos,
watermarks, logos). Rewrite every address of the old bucket in the database to the new one:

```
node scripts/s3RewriteAddresses.js --from oneplaces3 --to <new-bucket> --region us-west-2           # counts per column
node scripts/s3RewriteAddresses.js --from oneplaces3 --to <new-bucket> --region us-west-2 --apply   # rewrites them
```

Only the bucket part of each address changes. Logs and audit trails are left exactly as written.

### 7. Retire the old bucket

Keep the old bucket (already private after step 2) for 30 days as a fallback. After that, once
the new bucket has served everything without trouble, empty and delete it, so no copy of student
data stays outside the United States. Keep `S3_LEGACY_BUCKETS` set: any address the rewrite left
(a log, an email already sent) still opens the same file in the new bucket through Managira.

## One file to remove

`images/studentimages/63/chrome_proxy.exe` (2.5 MB, uploaded May 17, 2026 as a student photo) is a
Windows program, not a picture. Uploads of programs have since been refused
(`utils/uploadSafety.js`). It is private once step 2 is applied; delete it from the bucket (and
from the new one after the copy) once you have confirmed which record it belongs to.
