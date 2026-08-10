# Signup server transition deployment

This branch expects the Firebase callable functions below to be deployed before the frontend transition is promoted to production:

- `completeSignupProfile`
- `updateMasterControls`

Use targeted Functions deployment only. Do not deploy Firestore rules together with these Functions.

After deployment, sign in as an ADMIN and save the master controls once with a newly rotated instructor signup code. This stores only the server-side HMAC digest and removes the legacy plaintext `systemSettings/masterControls.instructorSignupCode` field.
