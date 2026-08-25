# Special Owner — Base Version

A base residential-compound management app: resident interface + admin dashboard, built with plain HTML/JS + Firebase (same stack as your other projects), packaged as a PWA so you can wrap it into an Android **AAB/APK** with PWABuilder — the same route you used for the Nour app.

## What's included

**Resident app** (`resident.html`)
- Home: points balance, outstanding dues, payment status list, announcements
- Invitations: generate a QR-code guest invite (name, phone, visit date)
- Maintenance: submit and track requests by category
- Shops: browse partner shops and current points balance

**Admin dashboard** (`admin.html`)
- Overview: residents / active workers / pending requests / overdue payments, post announcements
- Access: **live camera QR scanner** that validates an invitation and logs entry/exit
- Workers: add/list workers
- Finance: add payment records per resident (by unit + email), view all payments
- Maintenance: view all requests and change status (pending → in progress → completed)

**Not built yet (flagged in your outline as future work):** payroll/accounting module and bank-account integration. The data model below already has room for these.

## 1. Set up Firebase

1. Create a Firebase project (e.g. `special-owner`) at console.firebase.google.com.
2. Enable **Authentication → Email/Password**.
3. Enable **Firestore Database** (production mode).
4. In Project settings → your apps, add a **Web app** and copy the config object into `js/firebase-config.js` (replace the placeholder values).
5. Deploy the rules in `firestore.rules` (Firebase console → Firestore → Rules, paste and publish — or `firebase deploy --only firestore:rules` if you use the CLI).
6. **Create your first admin manually:** sign up normally through the app (creates a `resident` user), then in the Firestore console open that user's document under `users/{uid}` and change `role` from `"resident"` to `"admin"`. Every admin after that can be promoted the same way, or you can build an "promote user" button later.

### Firestore data model
```
users/{uid}            name, email, unit, role(resident|admin), points, createdAt
invitations/{id}       residentId, residentUnit, guestName, guestPhone, visitDate, token, status(pending|used), type, createdAt
payments/{id}          residentId, unit, amount, dueDate, description, status(pending|paid|overdue), createdAt
maintenanceRequests/{id} residentId, unit, category, description, status(pending|in_progress|completed), createdAt
announcements/{id}     title, body, createdBy, createdAt
shops/{id}             name, category, description, offer
workers/{id}           name, role, phone, status(active|inactive), createdAt
accessLogs/{id}        type(entry|exit), personType, personName, invitationId, timestamp
pointsTransactions/{id} residentId, amount, type(earn|spend), shopId, createdAt   ← wired for later use
```

## 2. Test it as a website first

Host the folder anywhere static (GitHub Pages, same as your other projects works fine): push this folder to a repo and enable Pages. Open the deployed `index.html`, sign up a resident, promote yourself to admin in Firestore, and click through both dashboards before packaging.

## 3. Package as AAB/APK (PWABuilder — same as Nour)

I can't compile a signed Android package directly in this chat (that needs the Android build toolchain and your signing keystore, which live outside this sandbox) — but the path is identical to what you already did for Nour:

1. Deploy this site to a public HTTPS URL (GitHub Pages URL works).
2. Go to **pwabuilder.com**, paste that URL, let it analyze the manifest/service worker (both are already included and valid).
3. Go to **Publish → Android**, choose **TWA (Trusted Web Activity)**, set package ID (e.g. `io.github.<you>.specialowner` — pick your own, it must be unique and permanent).
4. Download the generated Android project / signed bundle. PWABuilder will generate a `.jks` keystore for you the first time, or let you upload your own — **save that keystore file somewhere safe immediately**, exactly like the Nour keystore issue you hit before. Losing it means you can never update the app again.
5. It will give you both an **AAB** (for Play Store upload) and a **APK** (for direct testing on a device).
6. Before uploading to Play Console, add the Digital Asset Links file PWABuilder gives you (`assetlinks.json`) to `/.well-known/assetlinks.json` on your hosted site — this is what fixed the address-bar issue on Nour, same fix applies here.
7. Upload the AAB to a new Play Console app ("Special Owner"), fill Data Safety (this app collects: email, name, unit number → Account info; QR/invite data → App activity; stored via Firebase) and category (likely "House & Home").

## 4. Suggested next steps for the "advanced" version later
- Cloud Function to auto-flag payments `pending → overdue` past due date
- Points ledger: write to `pointsTransactions` and increment `users/{uid}.points` in a transaction whenever a shop purchase happens
- Worker time/attendance stats (clock-in QR similar to guest QR, tied to `workers/{id}`)
- Payroll + bank account linking module (flagged as future work in your outline)
