# SM Meetup 📅

A public activity calendar for students at our school — see what's happening,
join in, or host your own. Static site (GitHub Pages) + Firebase for accounts,
data, and live chat. **No build step.**

> First time here? Follow [SETUP.md](SETUP.md) to connect Firebase and deploy.

## What it does

- **Month calendar** of activities, shown on the day(s) they happen, with
  live updates — no refresh needed.
- **Grade filters** (9–12) to see only activities open to you.
- **Click an activity** → sidebar shows host, time, location, participants,
  requirements, and an updates/chat panel.
- **Join instantly** on open activities, or **request to join** and let the
  host approve/decline. Grade requirements and max-participant caps are enforced.
- **Host tools**: approve/decline requests, remove participants, post updates,
  delete the activity. Hosts choose at creation whether participants can chat
  or only the host can post.
- **Create activities** from the sidebar: name, description, location, one or
  more dates, time, allowed grades, requirements, join mode, chat toggle,
  optional participant cap.
- **Accounts required — school accounts only.** Sign-ups must use a verified
  `@smtexas.org` email (enforced by the security rules, not just the form).
  Every profile needs a display name, grade, and **two contact methods** you
  actually check (phone / email / Instagram / Discord / other), visible to
  other signed-in students so activities can coordinate.
- **Past activities grey out** the day after they happen and auto-delete
  ~2 months after their last day (the host can delete sooner).
- **Availability**: hit Availability and click days right on the calendar to
  cycle free → busy → default — changes auto-save, and a pulsing dot reminds
  you when your week is unmarked. Fine-tune single hours in the sidebar, and
  set a repeating weekly schedule for regular commitments (practice, work).
  Unmarked time counts as "maybe".
- **Friends**: search students, send/accept friend requests, unfriend.
- **Private meetups**: create a private activity and invite friends — the
  calendar becomes a group-availability heatmap (greener = more people free,
  best hour labeled), with an hour-by-hour breakdown to pick the time.
  Private activities are invisible to everyone not involved.

## Files

```
index.html          page shell (auth screen, profile setup, main app)
styles.css          styles
js/app.js           entry point: auth flow, month subscription, header
js/calendar.js      month grid rendering
js/sidebar.js       activity details, join flows, host tools, chat, create form, profiles
js/availability.js  free/busy editor + group-availability math for the heatmap
js/friends.js       friend requests, friendships, the Friends panel
js/auth-ui.js       sign in / sign up / profile setup forms
js/firebase.js      Firebase init
js/firebase-config.js  ← paste your Firebase project config here
js/util.js, js/store.js  helpers + shared state
firestore.rules     security rules — paste into the Firebase console
```
