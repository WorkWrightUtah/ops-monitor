# Decisions Log

> Append-only. Log any structural or scope choice the day it's made (CLAUDE.md rule).
> Newest at the top.

## 2026-08-14 — The Teams channel is now an email address
**What changed:** the checker posts to Teams by emailing the channel's own address through Resend.
No OAuth, no n8n, no Power Automate. `TEAMS_CHANNEL_EMAIL` on the Railway `checker` service; unset
it and the old n8n webhook path takes over again, which is the rollback.

**Why, in one line:** Ryan asked what makes this permanent, and the honest answer is that nothing
authenticating *as a person* ever is. Delegated tokens expire on password changes, policy updates,
and 90 days of nothing. An email address has no token to expire. The failure we spent this week on
cannot happen to this path, because the thing that broke does not exist in it.

**What it costs:** the alerts render as plain email in the channel rather than a coloured Adaptive
Card. Worth it. The card looked better and arrived nowhere for seven days.

**The trap, which cost an hour and would cost the next person the same.** Teams lets you restrict
which domains may post to a channel address. Set it to `workwright.co` — the domain in our `From:`
header — and every message is silently discarded, because **Teams matches the envelope sender, not
the From header**, and Resend's return path is on `send.workwright.co` (its SPF records live on the
`send` subdomain). Resend reports `delivered` throughout, because Microsoft accepts the mail and
then drops it. Both domains are now allowed. The first test vanished; the second, after adding
`send.workwright.co`, landed. That is the only reason we know.

**A failure here now sends mail.** If the Teams leg fails while the mailbox leg succeeds, the
checker sends a second, separate email naming the underlying error. That answers the actual
request — "make sure it sends me an email if it breaks" — for every failure Resend reports.

**What it still does not catch, stated plainly:** Teams accepting the mail and discarding it, as in
the trap above. Resend says delivered, nothing arrives, nothing warns. Detecting that needs
something reading the channel, which is a bigger machine than this problem deserves today. It is in
the README so the next person checks the channel before believing a log line — the same lesson as
2026-08-13, learned again from the other end.

## 2026-08-13 (later) — Tried to move Teams off Power Automate, and reverted
**Attempted:** replace the Power Automate hop with n8n's Microsoft Teams node, so a failed post
would show as a failed n8n execution instead of a green one. Built it, published it, tested it,
and backed it out the same hour. Teams alerts run through Power Automate exactly as before.

**Why it failed — n8n fixes the OAuth scopes and the ones it asks for cannot post.** Graph was
blunt about it: `Missing scope permissions. API requires one of 'ChannelMessage.Send,
Group.ReadWrite.All'. Scopes on the request 'ChannelMessage.Read.All, Chat.ReadWrite,
Group.Read.All, openid, User.Read.All, profile, email'`. n8n Cloud's managed OAuth connects
happily and hands back a token that can read Teams and not write to it. The scope field is hidden
on both `microsoftTeamsOAuth2Api` and `microsoftOAuth2Api`, so there is no way to ask for
`ChannelMessage.Send` through either credential.

**This is the second time.** The workflow's own version history from 2026-08-06 says "The Microsoft
Teams OAuth credential never completed consent" — someone hit this wall, gave up, and fell back to
the Power Automate webhook. The abandoned `workwrightopsteams` app registration in Entra is the
wreckage of that attempt. Recording it here so there isn't a third.

**The way through, if anyone wants it later:** a generic n8n **OAuth2 API** credential, which is
the only one with an editable scope field, set to `openid offline_access ChannelMessage.Send`,
driving an HTTP Request node against
`POST https://graph.microsoft.com/v1.0/teams/{team}/channels/{channel}/messages`. That needs the
`workwrightopsteams` client secret, and a second redirect URI on the app —
`https://oauth.n8n.cloud/oauth2/callback`, which differs from the one the Teams credential uses.
Worth noting it is also the *least*-privilege option: `ChannelMessage.Send` alone, versus the
tenant-wide `Group.ReadWrite.All` the Teams node would have required.

**Not doing it yet, deliberately.** The n8n workspace is on a trial with six days left, and every
Teams alert routes through n8n. Spending an Entra app registration and a broad consent to harden a
dependency that may expire next week is the wrong order of operations. If the trial is not
converted, the right answer is to post to Teams from the checker directly and delete this hop.

**What did survive the attempt:** proof that the checker's own reporting can be made honest. With
the webhook set to respond after the workflow rather than on receipt, the failing Teams post came
back as `n8n 500` and the checker logged `teams=failed` — the first time in this project's life
that log line told the truth about Teams. That one-line change is worth re-applying the moment the
post itself is done by something that fails loudly.

## 2026-08-13 — The Teams channel was dead for a week and every log said it was fine
**What happened:** Microsoft's weekly digest reported that "Send webhook alerts to General" had
failed 15 times. It had. The flow's Microsoft Teams connection (owned by benson@workwright.co) lost
its token on the evening of 2026-08-06, and `Post card in a chat or channel` has returned
`Unauthorized` on every run since. Exactly one card has ever reached the channel: the build test on
2026-08-06. Every real alert since — including all four on the 11th — went to email only.

**The fix is one click** on Power Automate's "Reauthenticate" banner. That is not the interesting
part.

**The interesting part is that nothing on our side noticed for a week**, and not through neglect —
through design. Every hop in the Teams path answers before it does the work. n8n's webhook replies
"Workflow got started" and *then* runs, so the checker sees a 200. Power Automate replies `202
Accepted` with an empty body and *then* runs the flow, so n8n's HTTP node sees a success. Six n8n
executions are recorded as successful; all six correspond to runs that failed inside Power
Automate. There is no response anywhere in that chain that could have told us the truth, so this
was not a bug to find — the information never left Microsoft.

**Worth being blunt about:** `teams=accepted` in the checker logs means "n8n took the request." It
has never meant a human saw anything. We already made this mistake's twin with Resend and chose the
honest word "accepted" over "sent" for exactly this reason; the wording held up, and it still
wasn't enough, because nobody re-reads a log line that says the thing succeeded.

**What we did not do:** rebuild the alert path. Email and Teams are independent channels and the
independent one worked for the entire week — the redundancy did its job, which is the case *for*
having two channels rather than an argument that this one is fine. The durable fix (moving the post
off Power Automate so a failure is at least *visible*) is a real change with a real cost and is
Ryan's call, not something to slip in while fixing an expired token. Logged here so the next person
who sees "teams=accepted" alongside a silent channel does not spend an afternoon debugging the
checker. Runbook: README → "When Teams cards stop arriving but email keeps working."

## 2026-08-11 — A second vantage point, and the threshold raised to three
**Why:** both at Ryan's request, after a day of alerts he didn't believe. The threshold change is
one line and a real trade: three consecutive failures spans ten minutes rather than five, so a
genuine outage is now reported five minutes later than it used to be. That was paid deliberately to
buy back trust in the alerts that do arrive — an alert nobody believes is worth less than one that
comes late.

**The Worker is the interesting half.** `workers/vantage` is a Cloudflare Worker that fetches a URL
and reports the status code, nothing else. When our own check fails, the checker asks it and
`reconcile()` combines the two readings. The point is not redundancy — it is that a single vantage
point *cannot* distinguish "the site is refusing everyone" from "the site is refusing us", and
those need opposite responses. Two unrelated networks can.

**It moves the verdict in both directions**, which is what makes it worth the moving parts:
`down` + a Worker that sees the site fine becomes `blocked` (do not page someone over our own
network), and `blocked` + a Worker that is *also* refused becomes `down` (nobody can reach this
site, whatever the status code says). That second case buys back the coverage we gave up an hour
earlier by not paging on refusals at all.

**The row most likely to be wrong** is `blocked + blocked -> down`. Cloudflare's egress is still a
datacenter, and a filter strict enough to refuse us might refuse it too — in which case we are back
to paging falsely, which is the thing we set out to stop. Three consecutive double-refusals is
fifteen minutes of two independent networks being turned away, which is decent evidence but is
evidence, not proof. **If this ever pages falsely, that row is the first thing to reconsider.**

**Failure is not an error.** Unconfigured, unreachable, rate limited, rejecting our token, or
returning nonsense all produce the same answer — "unavailable" — and the checker then behaves
exactly as it did before. A monitoring tool must not be able to fall over because the thing that
makes it better stopped working, and this shipped *before* the Worker was reachable precisely so
that property got exercised rather than assumed.

**`checks.outcome` now stores the verdict** instead of every reader deriving it from the status
code. Two checks with identical status codes can now mean opposite things, so recomputing later
from evidence that no longer contains the second reading would quietly produce a different answer
than the one we alerted on. Nullable, with a fallback function, because a NOT NULL column would
have broken every insert from the currently-deployed checker the moment the migration landed — and
the gap between a migration and a deploy is exactly when a monitor must not go blind.

**Two things worth remembering from doing it:**
- `CREATE OR REPLACE VIEW` can only *append* columns. Slotting `last_outcome` in beside the other
  `last_*` columns failed with "cannot change name of view column"; it now sits at the end, which
  is uglier and cheaper than dropping a view the dashboard reads.
- `.env.local` cannot be `source`d — `ALERT_EMAIL_FROM=Ops Monitor <alerts@workwright.co>` is a
  bash syntax error, and sourcing it silently aborts *part way through*, leaving earlier variables
  set and later ones empty. That failure looks exactly like a wrong credential. Parse dotenv files,
  do not source them.

**Left for a human, deliberately:** the shared secret was generated locally and never entered a
transcript, tool call, or commit. There is no Railway CLI on this machine, so setting the variable
means passing the value to an MCP tool — which is writing a secret into a prompt, and the house
rules say never. Ryan sets it from the file himself.

**Revisit if:** the Worker's own egress starts getting blocked (the whole thing degrades to today's
behaviour, but silently — the logs are the only tell), or if `blocked + blocked` pages falsely.

## 2026-08-11 — "Refused" is a third outcome, and it does not page anyone
**Why:** Red Rock Bicycle's CDN began answering our checker with `403` at 08:10 MT and mostly kept
doing so for two hours and twenty minutes, while serving every real visitor normally. The checker
had two words for what it saw — up or down — so it called a healthy bike shop down and emailed
about it. Ryan looked at the site, saw it working, and told us the monitor was crying wolf. He was
right, and that is the expensive part: a monitor nobody believes costs the same as one they do and
still gets ignored on the day it is correct.

**The distinction now in the code:** `up` (we asked and got a good response), `down` (nothing
answered, or what answered was broken), `blocked` (something answered and turned us away).
`401`/`403`/`429` are `blocked`. It is deliberately a narrow list — every other `4xx` stays `down`,
because a `404` on a page a customer would visit is a real problem, and the spec's broken-route
seed target depends on that still alerting.

**Blocked is not a softer "down", it is the absence of information.** A `403` from an edge network
is near-affirmative evidence the site is serving: a genuinely broken site gives `5xx` or nothing.
So refusals are skipped when counting runs — they build toward neither an alert nor a recovery, and
a target holds whatever state it was already in. An open alert on a genuinely-down target that then
starts blocking us stays open rather than being quietly retracted on no evidence.

**Correction, one hour later — a long block now cuts the history off.** The first version of this
simply filtered refusals out, which welds the two sides of a block together. Deployed at 11:05; at
11:10 the checker read a success at 11:10 and a success at 10:30 as *two consecutive successes*,
2h20m and 28 refusals apart, satisfied the recovery threshold on two-hour-old evidence, and emailed
"Recovered". The outcome was harmless — it closed out the false alarm, and the flag needed clearing
anyway — but the mechanism was wrong, and the mirror image is not harmless: two failures either
side of a long block would have paged someone as though they had happened back to back. A run of
more than `MAX_BLOCKED_GAP` (3, about fifteen minutes) now stops the walk rather than being skipped
over. Two checks either side of a fifteen-minute blind spot are not consecutive in any sense worth
acting on. **Worth noting how it was caught:** not by the tests, which all passed, but by watching
what the thing actually did on the first cycle after deploying.

**How it was found:** running the checker's exact code path and exact user-agent from a laptop
returned `200`; so did a fetch from an unrelated datacenter; and the checker itself got a `200` at
10:30 in the middle of the "outage". The tell was in the data all along — refusals came back in
46–93 ms against 100–200 ms for real page loads. That is a CDN edge saying no, not an origin
failing. Nothing about this was visible from the code.

**Also fixed in the same pass, because the same morning exposed them:**
- **Recovery now needs two consecutive good checks, not one.** The single `200` at 10:30 fired
  "Recovered", and two refusals ten minutes later fired "DOWN" again — three emails, none true.
  Recovery deserves the same burden of proof the outage did; asymmetry is what let it flap.
- **Failed checks are retried once** after 3 seconds before being recorded. The alert threshold
  protected the alert, but nothing protected the history. Refusals are *not* retried: a site that
  just refused us will refuse us again, and doubling our request rate against a WAF that already
  dislikes our traffic is how a temporary block becomes a permanent one.
- **Uptime excludes refusals from both numerator and denominator** (`target_status` view). The old
  maths showed ~85% for a site that never missed a request. A wrong number in a client report is a
  worse failure than a noisy alert, because it survives longer and nobody double-checks it.
- **`HISTORY_WINDOW` 5 → 12.** Refusals no longer count toward runs, so a blocked stretch can fill
  the window with rows that say nothing; a wider window keeps enough real checks in view to reach a
  verdict at all.

**Judgement call, recorded because it is arguable:** dressing the checker up as Chrome would
probably walk straight past most bot filters. We don't. A monitor that lies about who it is cannot
be allowlisted by the people whose sites it watches, and the contact details in the user-agent are
the entire point of the string. Being honest is also what gets us blocked; that trade is accepted
deliberately, not overlooked.

**Unproven, kept cheap:** checks are now jittered up to 30s inside each 5-minute slot, on the theory
that requests arriving on a perfect grid from one datacenter IP are a recognisable machine
signature. That is a hypothesis about *why* nineteen clean hours turned into a block, not a
demonstrated fix. It costs up to half a minute of detection latency. If it turns out not to help,
delete it and lose nothing.

**Known limit:** a single checker in a single datacenter cannot tell "the site is refusing
everyone" from "the site is refusing us". Confirming a failure from a second vantage point before
alerting would close that gap; it is not built. Until it is, `blocked` is the honest name for what
we actually know.

**Revisit if:** a target sits Blocked for days (get the checker allowlisted at that site's CDN — the
user-agent carries contact details for this), or if a real outage is ever missed because it
presented as a `403`.

## 2026-08-10 — Route handlers must read the forwarded host, not `request.url`
**Why:** behind Railway's proxy, `new URL(request.url).origin` inside a route handler resolves to
the container's own bind address — `https://0.0.0.0:8080` — not the public hostname. Both auth
routes built their redirects from it, so a confirmation link arrived correctly at
`status.workwright.co/auth/callback` and was then redirected to an address no browser can reach.
**How it was found:** a deploy-detection poll printed its redirect target and the target was
`https://0.0.0.0:8080/auth/confirmed`. The trace that followed then died with an SSL error, because
it was trying to speak TLS to a plain-HTTP internal port. Neither would have been visible from the
code, and neither would have been visible from a build that passes.
**Middleware was never affected**, which is why the login gate worked perfectly throughout and made
this look like an auth bug rather than a URL bug: `request.nextUrl` already accounts for the
forwarded headers. Route handlers and server actions do not. `lib/site-url.ts` now centralises it.
**Revisit if:** anything else in `src/app/` starts constructing absolute URLs. It should use that
helper, not `request.url`.

## 2026-08-10 — A confirmed session can arrive in three shapes; all three are handled
**Why:** the confirmation link was fixed twice and still landed people on the login form. Tracing a
real link hop by hop against the live project — rather than reasoning about what Supabase *should*
send — showed it handing the session back as `#access_token=…` on the URL **fragment**. A fragment
is never transmitted to the server, so the callback route saw no `?code=`, concluded the link was
incomplete, and redirected to the login form while a valid session sat unread in the address bar.
**The three shapes, and what reads each:**

| Arrives as | Read by | Where |
|---|---|---|
| `?token_hash=` | `/auth/confirm` | server |
| `?code=` | `/auth/callback` | server |
| `#access_token=` | `HashSession` | browser only |

Which one turns up depends on project settings and on how the link was generated, not on our code —
so all three are handled rather than betting on one. `HashSession` also strips the tokens from the
address bar once used: they are live credentials and do not belong in browser history or in
whatever someone pastes a link into.
**Caveat recorded honestly:** the trace that found this used the admin `generate_link` API, which
skips the PKCE handshake a real form signup performs, so the live form may still produce `?code=`.
That is exactly the point — the app no longer needs to know which.
**The lesson, again:** three fixes were shipped for this before one was traced end to end. The first
two were reasoned from documentation and each was wrong in a way the next trace exposed in seconds.

## 2026-08-10 — Targets are added and removed from the dashboard, not from Supabase
**Why:** Ryan asked for it, and the runbook's weakest step was the one that sent a non-technical
owner into a production table editor to hand-type a URL. The form writes through the *request-scoped*
Supabase client, so inserts and deletes pass the same team-only RLS policies as the reads — the
`targets_insert_team` / `targets_delete_team` policies written on day one are finally being used by
something other than a test. The service_role client stays where it was, in the checker, and is
still never imported from `src/app/`.
**Two details that carry weight:**
- A delete refused by RLS returns *no error and no rows* from PostgREST — indistinguishable from
  success. `deleteTarget` calls `.select()` and treats zero rows as a failure, so a refusal can
  never be reported as a removal.
- The visible controls are gated on an email-domain check that mirrors `is_team_member()`. That is
  display only, duplicated deliberately and marked as such; the database remains the authority and
  the actions surface its refusal in words.
**Revisit if:** pausing (`active`) becomes something anyone reaches for. Add and remove were the
ask; pause is still a Supabase edit, and the README says so plainly rather than implying the
dashboard is the whole story.

## 2026-08-10 — URL normalising is its own tested module, and refuses credentials
**Why:** the form accepts `workwright.co` and assumes `https://`, because that is what people type.
The first implementation did that by prepending the scheme whenever the string didn't start with
`http`, which a test immediately caught as unsound: `mailto:ryan@workwright.co` became
`https://mailto:ryan@workwright.co`, which parses *successfully* with `mailto:ryan` as credentials
and `workwright.co` as the host — a rejected input silently turning into a valid, different target.
The same hole accepts `https://workwright.co@evil.com`, which the dashboard and every alert would
then print verbatim while checking `evil.com`.
**Now:** the scheme is identified before anything is prepended (distinguishing `mailto:` from a
`:8080` port), and any URL carrying user info is refused. Ten cases live in
`src/lib/target-url.test.ts`.
**The lesson repeats:** this was found by testing the pure function, not the form. Same shape as
the `hello@` bounce — the operation reported success while doing something other than what it said.
**Revisit if:** we ever need authenticated health checks. That wants a credentials column and a
secret store, not a URL string.

## 2026-08-10 — `targets.url` gets a unique index
**Why:** the README already claimed "one URL, one row — the database enforces it." **It did not.**
No unique constraint existed; the claim had been true only in the sense that nobody had tried.
Moving adds to a form makes double-pasting a site an easy accident, and two rows for one URL means
two checks every five minutes and two alerts with nothing in an inbox to tell them apart. The index
makes the sentence true and gives the form a `23505` to turn into "already on the board."
**Not `lower(url)`:** hostnames are case-insensitive and the URL parser already lowercases them, but
paths are case-sensitive — `/Status` and `/status` may be genuinely different pages.

## 2026-08-10 — Confirmation links land on `/auth/confirmed`, a page that exists
**Why:** the previous fix built `/auth/confirm` and `/auth/callback` and then showed a green banner
on the dashboard. That was still wrong twice over. First, Supabase's default template does not link
to our routes at all — it links to *its own* `/auth/v1/verify`, which confirms server-side and then
redirects to whatever `redirect_to` says, so our confirm route was never reached. Second,
`redirect_to` was `http://localhost:3000`, because it falls back to the project's Site URL.
**Now:** `signUp` passes an explicit `emailRedirectTo` built from the request headers, so the link
returns to whichever host the person actually signed up on; `/auth/callback` is the door the default
template uses, and it ends at a real page that says the words.
**A failed code exchange is not a failed confirmation.** Reaching the callback without an error
param means Supabase already verified the address — the exchange fails separately when the link is
opened in a different browser, since the PKCE verifier is a cookie. That case lands on the same page
in its signed-out wording rather than being reported as a broken link.
**Still requires a Supabase dashboard change:** `emailRedirectTo` is only honoured if the URL is in
the project's allowed Redirect URLs. Until `https://status.workwright.co/**` is listed *and* the
Site URL is off localhost, Supabase substitutes the Site URL and the link goes nowhere useful. This
is a project setting, not code, and the Management API token needed to set it isn't in this repo.

## 2026-08-08 — Alert email settles on `claude@workwright.co` (supersedes the `benson@` entry below)
**Why:** a shared mailbox that Benson and Ryan both read. That resolves the objection raised
against `benson@` — an alert landing in one person's inbox goes unread when they are away and
does not survive them leaving. Two readers is the point.
**Verified before switching:** test send returned `delivered`, not merely `accepted`. That check
is now standard practice here after `hello@workwright.co` bounced and silently swallowed two real
alerts.
**`hello@workwright.co` is no longer needed** for this build. It remains suppressed in Resend; if
anyone ever wants it as the alert address, the mailbox has to be created first and the suppression
deleted, or every send is dropped.

## 2026-08-07 — ~~Alerts go to `benson@workwright.co` for now, not `hello@`~~ (SUPERSEDED by the entry above)
**Why:** `hello@workwright.co` — the address the SOW names — hard bounces; it is not a real
mailbox (see below). `benson@workwright.co` was tested and returns `delivered`, so alerts point
there and the alert path is provably working end to end rather than blocked.
**Verified by effect, not by API response:** the outage notice and its recovery both show
`delivered` in Resend's sent-email list. The previous round showed `accepted` and delivered
nothing.
**This is deliberately temporary.** A monitoring alert that lands in one person's personal inbox
is a single point of failure — it goes unread when Benson is on holiday, and it does not survive
him leaving. The spec says `hello@`, and `hello@` is the right answer because a shared mailbox
has more than one pair of eyes on it.
**To finish properly:** create `hello@workwright.co` as a shared mailbox or distribution list in
Microsoft 365, delete the bounce suppression in Resend, then set `ALERT_EMAIL_TO=hello@workwright.co`
in Railway. No code change — it is one environment variable.

## 2026-08-07 — OPEN: `hello@workwright.co` hard-bounces; alert email goes nowhere
**What happened:** with Resend finally verified, the first test send to `hello@workwright.co`
returned HTTP 200 and then **hard bounced**. Resend automatically added the address to its
suppression list, so the next two alert emails — a real outage notice and its recovery — were
**silently dropped**. The checker logged `email=sent` for both.
**Root cause:** `workwright.co` routes mail to Microsoft 365, but `hello@` does not appear to be
a real mailbox or alias. The spec names it as the alert recipient; nobody had checked it exists.
**For Ryan — pick one:**
1. Create `hello@workwright.co` as a shared mailbox or alias in Microsoft 365, then remove the
   suppression in Resend, or
2. Change `ALERT_EMAIL_TO` to an address that does exist.
Either way the suppression entry must be deleted or every future send is dropped.
**Why this was nearly missed:** a 200 from Resend means *queued*, not *delivered*. The only
reason it surfaced is that the sent-email list was checked rather than trusting the logs.

## 2026-08-07 — "accepted" is not "delivered", and the logs now say so
**Why:** `sendEmail` returned `status: "sent"` on any 2xx from Resend. That word made a queued
message look like a delivered one, and it is exactly what made the bounce above invisible — three
emails reported as sent, zero received.
**Change:** the status is now `accepted`. Same behaviour, honest word. True delivery status needs
Resend delivery webhooks, which are out of scope for this build.
**Revisit if:** alerting becomes load-bearing for a paying client. Then webhooks stop being
optional, because "we sent it" is not a defence when nobody got it.
**Lesson worth keeping:** verify the effect, not the API response. The Teams half was proven by
reading the channel; the email half was "proven" by reading a log line, and the log line was wrong.

## 2026-08-06 — `railway.json` applies to every service built from the repo
**What happened:** the checker service deployed green and then crashed on every run with
"Could not find a production build in the `.next` directory." It was running `next start`, not
`npm run check`. A committed `railway.json` overrides start commands set per-service through the
API, and because two services build from this one repo, the web app's start command was being
applied to the cron job. Skipping the Next build for the checker — correct on its own — turned a
wrong-command problem into a crash.
**Two traps, not one:** a Railway **redeploy replays the previous build with its old config
snapshot**, so the first fix appeared not to work. Config changes need a fresh build from a push.
That cost two wasted redeploys before the pattern was obvious.
**Fix:** `railway.json` now carries only what both services genuinely share (builder, restart
policy). Start and build commands are per-service; `railway.checker.json` holds the cron schedule.
**Lesson worth keeping:** on a Railway cron service, `SUCCESS` means the image built — not that
the job ran. Always read the deploy logs, or check that the work actually landed in the database.
A green checkmark was reported as a working deploy here, and it wasn't.

## 2026-08-06 — Teams via an incoming webhook, not the n8n Microsoft Teams node
**Why:** the Teams node needs a `microsoftTeamsOAuth2Api` credential. Two were created and
neither ever completed consent — both failed with "Unable to sign without access token" — and
Teams OAuth commonly dead-ends on Azure AD tenant admin consent that the builder cannot grant.
The channel's own Power Automate incoming webhook needs no OAuth at all and is self-serve from
the channel in about two minutes.
**Shape:** checker → n8n webhook → HTTP Request → Teams incoming webhook. n8n stays in the path
because the spec names it, and it earns its place: the Adaptive Card is built in n8n from the
checker's structured payload (`event`, `target`, `reason`, `checked_at`), so the message can be
reformatted without redeploying the app. The card is colored Attention for an outage and Good
for a recovery.
**Verified:** the full alert lifecycle ran end to end — silent on failure 1, one alert on
failure 2, silent on failure 3, one recovery on deactivation, silent after. Three n8n executions
recorded, all successful, none spurious.
**Revisit if:** Teams OAuth gets granted tenant-wide, or the webhook URL needs rotating — it is
currently stored in the n8n node and in Railway, not in the repo.

## 2026-08-06 — There are two Cloudflare zones for `workwright.co`; only one is live
**What happened:** the Resend DKIM/SPF records were added and Resend stayed `pending`. It read
like DNS propagation. It wasn't. `workwright.co` delegates to `elijah`/`sue.ns.cloudflare.com`,
but the zone the records went into is served by `igor`/`naya.ns.cloudflare.com` — a second
Cloudflare zone for the same domain. Querying both authoritative servers directly settled it:
`igor` returned the DKIM record, `elijah` returned NXDOMAIN. Nothing added to the `igor` zone is
visible to the internet.
**How to tell you are in the right zone:** the live one already serves `MS=ms31682083` and the
Outlook MX/SPF records, and those resolve from a public resolver. The dead one looks identical in
the dashboard.
**Applies again at deploy:** the `status.workwright.co` CNAME must go in the `elijah`/`sue` zone
too, or SSL will not issue and the site will not resolve — the same failure, one phase later.
**Rejected fix:** repointing the registrar at `igor`/`naya`. That would move live Microsoft 365
mail for the whole domain onto a zone nobody is currently relying on, to solve a problem that a
copy-paste of three records solves.
**Lesson worth keeping:** when a DNS change "hasn't propagated," ask the authoritative nameserver
directly before waiting. `nslookup -type=TXT <record> <the-ns>` answers in a second what an hour
of refreshing a status page will not.

## 2026-08-06 — One `targets.alerting` boolean after all (supersedes the derived-state decision below)
**What changed:** the earlier decision derived alert state entirely from the tail of `checks`.
Re-reading the acceptance criteria before writing the checker killed it: *"deactivating it
produces exactly one recovery notice."* Deactivating a target stops the checker writing rows for
it, so the "first successful check" that the derived design keys recovery off never arrives — it
would send nothing at all. And because the check history then freezes, any notice keyed off that
frozen tail would re-send every five minutes, breaking "no repeats" in the other direction.
**Why a boolean and not an `alerts` table:** the column answers the single question the history
genuinely cannot — *have we already told someone?* Everything else still comes from `checks`: the
two-consecutive-failure threshold is counted from the check rows, not tracked in a counter. One
column, one question.
**The flag is set only after a send succeeds,** so a Resend or webhook failure leaves the alert
outstanding and the next run retries rather than marking an outage announced that nobody heard.
**Trade-off accepted:** flag and history can in principle disagree if the process dies between
sending and updating. The next run self-corrects: a target still failing with `alerting = false`
just alerts again, which is a duplicate message rather than silence. Erring toward one extra
email beats erring toward an unreported outage.
**Revisit if:** we need an audit trail of who was notified and when — that is a real `alerts`
table, and this column becomes a view over it.

## 2026-08-06 — OPEN QUESTION: Supabase Auth still needs custom SMTP wired to Resend
**The question for Ryan:** signup confirmation and password-reset mail currently goes through
Supabase's built-in mailer, which is rate-limited to a couple of messages an hour and is intended
for testing only. Nothing is broken today because the accounts that exist were provisioned
directly, but the first time a team member self-registers or forgets a password, the mail will
silently not arrive.
**Fix when unblocked:** once `workwright.co` finishes verifying in Resend, point Supabase's
custom SMTP at Resend in the dashboard (Project Settings → Auth → SMTP). It is a settings change,
not code, which is why it isn't in a migration.
**Not blocking:** the acceptance criteria only require that login works and that a non-team
account sees nothing — both are proven.

## 2026-08-06 — Email + password login, not magic links
**Why:** the spec asks for "Supabase Auth, email login" and leaves the mechanism open. Magic
links would make every single sign-in depend on mail delivery, and mail is the one part of this
stack that is not yet verified (see the open question above) — a monitoring tool that can't be
logged into during an outage because its login email is queued is exactly the wrong failure.
Passwords work with no external dependency.
**Sign-up is left open on purpose:** RLS, not the absence of a sign-up form, is the security
boundary. An outsider can create an account and will see an empty dashboard, which is precisely
the acceptance test the spec asks for. Keeping sign-up open means that test can be run by anyone,
any time, without an admin handing out credentials.
**Revisit if:** the shop standardizes on SSO, or open sign-up starts collecting junk accounts —
at which point disable sign-ups in the Supabase dashboard and provision team members by hand.

## 2026-08-06 — Team membership is "a `@workwright.co` email", enforced by one SQL function
**Why:** the spec's data model is two tables, and a roles table would have made it three for a
tool with exactly one role. `public.is_team_member()` reads the caller's JWT and compares the
email domain; every RLS policy calls it, so "who is the team" is defined in one place instead of
copied across six policies. Domain comparison uses `split_part(lower(email), '@', 2) = 'workwright.co'`
— an exact match on the domain, not a `LIKE '%@workwright.co'` suffix, which would also have
accepted addresses ending in a lookalike domain.
**Revisit if:** we need more than one role (e.g. read-only contractors), or team members start
signing in with addresses off the workwright.co domain. Either turns this into a real membership table.

## 2026-08-06 — `lower()` the email before the domain comparison
**Why:** testing the gate against candidate identities before wiring any UI showed
`Ryan@WorkWright.co` failing a check that `ryan@workwright.co` passed. Supabase does not
guarantee the JWT email claim is lowercased. The failure mode is silent — RLS returns an empty
result set, not an error — so a team member with a capitalized address would have seen an empty
dashboard and no explanation.
**Revisit if:** never; this is a bug fix, kept here because the near-miss is the lesson.

## 2026-08-06 — ~~Alert state is derived from `checks`, not stored on `targets`~~ (SUPERSEDED, same day, by the `targets.alerting` entry above)
**Why:** the de-duplication rules ("fire at two consecutive fails", "no repeats while down",
"one recovery notice") all describe the *tail* of a target's check history, and the tail is
already in `checks`. Counting consecutive failures from the newest row backwards gives:
fire when the run length is exactly 2; stay quiet when it's 3 or more (already alerting);
send recovery when the newest check is `ok` and the run of failures immediately before it
was 2 or more. No `alerting` boolean to keep in sync, no third table, and no way for the
flag and the history to disagree after a crash mid-write.
**Trade-off accepted:** each evaluation costs one small indexed read per target instead of
reading a cached boolean. At ~3 targets every 5 minutes that is free, and
`checks (target_id, checked_at desc)` serves it directly.
**Revisit if:** target count grows into the hundreds, or we add alert rules that depend on
something not recoverable from check history (e.g. "who acknowledged this outage").

## 2026-08-06 — Scheduler: a Railway cron service, not an in-app scheduler
**Why:** the spec allows either and asks that the choice be logged. A separate Railway service
running `*/5 * * * *` and exiting keeps the checker independent of the web process — a redeploy,
crash, or idle-sleep of the dashboard can't silently stop the monitoring, which would be the
worst possible failure for a tool whose whole job is noticing when things stop. Five minutes is
also exactly Railway's minimum cron interval, so the spec's cadence fits without fighting the
platform. It's the version of this that teaches "background work on Railway," which the SOW names
as the skill this phase trains.
**Trade-off accepted:** two services to deploy and configure instead of one.
**Revisit if:** Railway cron's cold-start latency starts eating a meaningful share of the
5-minute budget, or we need sub-5-minute checks.

## 2026-08-06 — No `org_id` on `targets` or `checks`
**Why:** CLAUDE.md calls `org_id` "cheap insurance — apply it regardless of flag unless there's a
reason not to." This is the documented reason not to. The tool is WorkWright-internal, watches
only WorkWright property (the spec puts client-owned monitoring explicitly out of scope), and the
spec pins the schema to the listed columns "unless a decision in `decisions.md` justifies more."
A tenancy column with exactly one value forever is a column every query has to explain.
**Revisit if:** ops-monitor is ever pointed at client-owned properties, or turned into the
per-client status tooling behind a Shop-Kept care plan. That is a flag-A rebuild and `org_id`
comes back on day one.

## 2026-08-06 — `checks.status_code` is nullable
**Why:** a DNS failure, refused connection, or timeout is a real failed check with no HTTP status
to record. NULL says "no response arrived"; writing `0` or `599` would be inventing a status code
the server never sent, and every reader would then have to know our private convention.
`ok = false` carries the failure; `status_code` carries only what the server actually said.
**Revisit if:** we need to distinguish failure *kinds* in the dashboard, which would call for a
proper `error` column rather than overloading the status code.

## 2026-08-06 — All three seed targets start inactive
**Why:** `workwright.co` and `status.workwright.co` did not resolve when the seed migration was
written — the spec conditions the marketing site on "once it's live," and the monitor can't watch
itself before Phase 5 deploys it. Seeding them active would have generated a genuine outage alert
about sites we simply hadn't shipped yet, teaching everyone to ignore the alerts on day one. The
broken 404 route stays inactive by the spec's own instruction, except when testing.
**Revisit if:** n/a — flip each one active as it goes live. Tracked in the README runbook.

## 2026-08-06 — Outcome flag: internal (WorkWright-owned)
**Why:** the SOW names the flag "WorkWright-owned (internal)," which is not one of CLAUDE.md's
A/B/C. It behaves like **C — Shop-Kept** on infrastructure (dedicated Railway + Supabase project,
n8n automation allowed) with WorkWright as its own client, so email sends from `workwright.co`
rather than a client domain. Recorded here because "flag" appears in the README and drives the
tenancy and email rules.
**Revisit if:** the shop starts selling this as per-client status monitoring — that's flag A.
