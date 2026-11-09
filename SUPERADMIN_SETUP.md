# Super Admin account — one-time setup

The Super Admin is pinned to **anasalamaamir@gmail.com** in `firestore.rules`
(`isSuperAdmin()` checks the signed-in email, not only the `role` field), so nobody can
become Super Admin by editing a document, and plain admins cannot even read this profile.

The password is never stored in the project. Create the account yourself, once:

1. **Create the sign-in** — Firebase Console → Authentication → Users → *Add user*.
   Email `anasalamaamir@gmail.com` + your password. Do this BEFORE anyone else can sign up
   with that email on the public registration form (sign-up is open to anyone).
   Copy the new user's **UID**.
2. **Create the profile** — Firestore → collection `users` → new document whose ID is that UID:
   - `name` (string): your name
   - `email` (string): `anasalamaamir@gmail.com`
   - `role` (string): `superadmin`
   - `accountStatus` (string): `active`
   - `createdAt` (timestamp): now
3. **Publish `firestore.rules`** (Firestore → Rules → paste → Publish).
4. Sign in from the normal login page. You land on `superadmin.html`.

If you already had another Super Admin account (different email): after the rules are
published it loses its privileges (it is no longer the pinned email). Delete or change its
`users/{uid}` document.

After the first login, change the password (Authentication → the user → *Reset password*,
or use "Forgot password" on the login page), because the first one was shared in a chat.
