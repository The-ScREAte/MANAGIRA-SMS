# Email authentication for managira.com (SPF, DKIM, DMARC)

Managira sends every email (sign-in codes, reminders, report cards, receipts, invitations)
through Namecheap Private Email (`mail.privateemail.com`), from addresses on managira.com. The
domain's DNS is at Namecheap. District mail filters and security reviews check three records;
this page gives each one exactly.

## Where things stand (checked November 15, 2026)

| Record | Now | Needed |
|---|---|---|
| SPF | `v=spf1 include:spf.privateemail.com include:amazonses.com ~all` | Fine; Amazon SES can be removed (below) |
| DKIM | **None published.** The school-site wildcard (`*.managira.com` → Render) answers every `_domainkey` name instead | A TXT record from Private Email |
| DMARC | `v=DMARC1; p=none;` (no reports, no protection) | Reports first, then enforcement |

Without DKIM, a DMARC policy can't be enforced safely, so the order below matters.

## 1. DKIM (first)

1. Namecheap › Private Email › **Manage** for managira.com › DKIM › **Generate**, then **Show DKIM**.
2. Namecheap › Domain List › managira.com › Advanced DNS › **Add new record**: type **TXT**, the
   host exactly as shown (`default._domainkey` for subscriptions bought before June 2, 2026,
   otherwise `privateemail._domainkey`), the value exactly as shown.
3. A record at that exact name takes precedence over the `*` wildcard, so school sites are not
   affected.
4. After up to an hour, `dig +short TXT default._domainkey.managira.com` (or the `privateemail`
   name) must return a value starting `v=DKIM1`.

## 2. SPF

Nothing in Managira sends through Amazon SES. If no other tool of yours does either, change the
record to:

```
v=spf1 include:spf.privateemail.com ~all
```

Keep `~all` until DMARC is enforced (step 3c); then `-all` is optional.

## 3. DMARC (in three stages)

Create a mailbox or alias to receive the daily reports, for example `dmarc@managira.com`, then
change the TXT record at host `_dmarc`:

a. **Now** (collect reports, change nothing for delivery):
   ```
   v=DMARC1; p=none; rua=mailto:dmarc@managira.com; fo=1
   ```
b. **After two weeks of reports in which Managira's own mail passes:**
   ```
   v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@managira.com; fo=1
   ```
c. **After two more weeks without problems:**
   ```
   v=DMARC1; p=reject; rua=mailto:dmarc@managira.com; fo=1
   ```

## 4. Check

Send a sign-in code to a Gmail address, open it, and choose **Show original**. All three must
read PASS: SPF, DKIM (`d=managira.com`) and DMARC.

## Optional: CAA

A CAA record limits which certificate authorities may issue certificates for managira.com. Add
one only after Render confirms which authorities it uses for custom domains: a CAA record that
leaves one out stops certificate renewal and takes the site and every school site offline.
