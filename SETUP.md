# SM Meetup — Setup Guide

The app is 100% static files — no build step, no server of your own. All the
live stuff (accounts, activities, chat) runs on Firebase's free tier.
Setup is three parts: **Firebase**, **paste the config**, **GitHub Pages**.

---

## 1. Firebase (one-time, ~10 minutes)

### Create the project
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project** → name it (e.g. `sm-meetup`) → Google Analytics is optional
   (you can turn it off) → **Create project**.

### Turn on sign-in
3. In the left sidebar: **Build → Authentication → Get started**.
4. Under **Sign-in method**, enable **Email/Password** (just the first toggle) → Save.

> Accounts are restricted to **@smtexas.org** emails, and people must click a
> verification link before they can use the app. Both are enforced by the
> security rules (step 7), not just the signup form. To change the domain,
> edit `SCHOOL_DOMAIN` in `js/util.js` **and** the domain in `firestore.rules`.
>
> Heads-up: school email systems often pre-open links to scan for phishing,
> which can trigger the verification on its own (you may see "link already
> used" when you click it yourself — that's fine, the account is verified).

### Create the database
5. **Build → Firestore Database → Create database**.
6. Pick the location closest to you → start in **production mode** → Create.
7. Open the **Rules** tab, delete what's there, paste in the entire contents of
   [`firestore.rules`](firestore.rules) from this folder, and hit **Publish**.
   These rules are what keep people from editing each other's activities or
   posting in chats they're not allowed in — don't skip this.

### Get your config
8. Click the ⚙️ gear (top of sidebar) → **Project settings**.
9. Scroll to **Your apps** → click the **`</>`** (Web) icon → nickname it
   (e.g. `sm-meetup-web`) → **don't** check Firebase Hosting → Register app.
10. It shows a `firebaseConfig = { ... }` block. Copy those values into
    [`js/firebase-config.js`](js/firebase-config.js), replacing the `PASTE_...`
    placeholders. (These values are fine to commit publicly — security comes
    from the rules, not from hiding the config.)

### One composite index (the app will remind you)
The calendar query (public activities for a month) needs a composite index.
Easiest way: run the app, sign in, and if a yellow banner appears, open the
browser console (F12) — Firestore logs an error containing a long
`https://console.firebase.google.com/...` link. Click it → **Create index** →
wait a minute → reload. That's it, one time only.

---

## 2. Test it locally

Any static file server works. From this folder:

```
python -m http.server 8123
```

then open <http://localhost:8123>. (You can't just double-click `index.html` —
JavaScript modules need to be served over http.)

Create an account, fill in your profile, make a test activity. Open a second
browser (or a private window) with a second account to test join requests,
approvals, and chat.

---

## 3. Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `sm-meetup`) and push **the contents of this
   folder** to it (so `index.html` is at the repo root).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / root → Save.
3. Your app will be at `https://<your-username>.github.io/<repo>/`.

### One important extra step
Firebase blocks sign-ins from unknown websites. In the Firebase console:
**Authentication → Settings → Authorized domains → Add domain** → add
`<your-username>.github.io`. (`localhost` is already allowed for testing.)

---

## How the data is laid out (for future you)

```
users/{uid}
  displayName, grade (9–12), contacts: [{type, value} × 2], email
  classOf                           ← graduation year; today's grade is derived
                                      from it and rolls over every Aug 20
  weekly: { weekday "0"-"6": { hour "6"-"22": "free"|"busy" } }   ← repeating availability
  dates:  { "YYYY-MM-DD":    { hour: "free"|"busy" } }            ← per-date overrides
  (anything unmarked = "maybe")

activities/{id}
  name, description, location
  visibility: "public" | "private"
  dates: ["2026-09-14", ...]        ← every day it happens
  monthKeys: ["2026-09", ...]       ← lets the app load one month at a time
  timeStart / timeEnd ("15:30")
  grades: [9, 10]                   ← who may join (public only)
  requirements (free text)
  openJoin (true = instant join, false = host approves; private is invite-based)
  allowChat (false = only host can post)
  maxParticipants (number or null)
  hostUid, hostName
  participants: [uid], participantNames: {uid: name}
  pending: [uid], pendingNames: {uid: name}         ← join requests (public)
  invited: [uid], invitedNames: {uid: name}         ← pending invites (private)
  visibleTo: [uid, ...]             ← host + invited + joined; drives private reads
  expiresAt                         ← last day + ~2 months; then anyone may delete
                                      (the app auto-deletes them on load)

activities/{id}/messages/{id}
  uid, name, text, createdAt        ← chat + host updates, live via onSnapshot

friendRequests/{fromUid}_{toUid}    from, fromName, to, toName, createdAt
friendships/{uidA}_{uidB}           users: [a, b] (sorted), names: {uid: name}
```

## Notes & ideas for later

- **Privacy model**: any verified student can see any profile (name, grade,
  contacts, availability). Private activities and their chats are only
  readable by the host + invited/joined people — enforced by rules.
- **Moderation**: there's no report/block yet — as host you can remove people
  from your activity, and you can delete your activity entirely.
- Deleting an activity leaves its chat messages orphaned in Firestore
  (invisible to users, tiny storage cost). A scheduled Cloud Function could
  clean them up if it ever matters.
