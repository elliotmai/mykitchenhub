# Firebase Project Setup Guide (Step 0.2)

## Overview
This guide walks you through setting up Firebase for MyKitchenHub. Estimated time: 2 hours.

---

## Part 1: Create Firebase Project (Manual - Firebase Console)

### Step 1.1: Create the Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Create a project"** (or "Add project")
3. Enter project name: `mykitchenhub` (or your preferred name)
4. **Enable Google Analytics** - Optional but recommended for tracking
5. Select or create a Google Analytics account
6. Click **"Create project"**
7. Wait for project creation (~30 seconds)
8. Click **"Continue"**

### Step 1.2: Register Web App
1. In the Project Overview, click the **Web icon** (`</>`)
2. Enter app nickname: `MyKitchenHub Web`
3. ✅ Check **"Also set up Firebase Hosting"** (optional, we're using Netlify but good to have)
4. Click **"Register app"**
5. **IMPORTANT:** Copy the Firebase configuration object shown - you'll need this!

The config looks like this:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "mykitchenhub-xxxxx.firebaseapp.com",
  projectId: "mykitchenhub-xxxxx",
  storageBucket: "mykitchenhub-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

6. Click **"Continue to console"**

---

## Part 2: Enable Authentication

### Step 2.1: Set Up Email/Password Auth
1. In the left sidebar, click **"Build"** → **"Authentication"**
2. Click **"Get started"**
3. In the **"Sign-in method"** tab, click **"Email/Password"**
4. Toggle **"Enable"** to ON
5. (Optional) Toggle **"Email link (passwordless sign-in)"** - nice for password reset
6. Click **"Save"**

### Step 2.2: Configure Authorized Domains (for Netlify)
1. Still in Authentication, click the **"Settings"** tab
2. Scroll to **"Authorized domains"**
3. Click **"Add domain"**
4. Add your Netlify domain (you'll get this after Netlify setup):
   - `your-app-name.netlify.app`
   - Your custom domain if you have one

---

## Part 3: Create Firestore Database

### Step 3.1: Initialize Firestore
1. In the left sidebar, click **"Build"** → **"Firestore Database"**
2. Click **"Create database"**
3. Select **"Start in test mode"** (we'll add security rules later)
   
   > ⚠️ Test mode allows all reads/writes for 30 days. We'll configure proper security rules before launch.

4. Choose a location closest to your users:
   - For US: `us-central1` or `us-east1`
   - For Europe: `eur3` (europe-west)
5. Click **"Enable"**

### Step 3.2: Create Initial Collections (Optional - can be done via code)
The app will create these automatically, but you can set them up manually:

1. Click **"Start collection"**
2. Collection ID: `users`
3. Add a dummy document (we'll delete it):
   - Document ID: Click "Auto-ID"
   - Field: `placeholder`, Type: `string`, Value: `delete me`
4. Click **"Save"**

---

## Part 4: Set Up Cloud Storage

### Step 4.1: Initialize Storage
1. In the left sidebar, click **"Build"** → **"Storage"**
2. Click **"Get started"**
3. Select **"Start in test mode"**
4. Choose the same location as Firestore (e.g., `us-central1`)
5. Click **"Done"**

### Step 4.2: Note Your Storage Bucket
Your storage bucket URL will be: `gs://mykitchenhub-xxxxx.appspot.com`

This is already in your Firebase config as `storageBucket`.

---

## Part 5: Get Your Firebase Configuration

### Step 5.1: Find Your Config
1. Click the **gear icon** ⚙️ next to "Project Overview"
2. Select **"Project settings"**
3. Scroll down to **"Your apps"**
4. Under the Web app, you'll see **"SDK setup and configuration"**
5. Select **"Config"** radio button
6. Copy the entire `firebaseConfig` object

### Step 5.2: Create Your .env File
Create a file named `.env` in your project root with these values:

```
REACT_APP_FIREBASE_API_KEY=your_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
```

> ⚠️ **IMPORTANT:** Add `.env` to your `.gitignore` file!

---

## Part 6: Verify Setup Checklist

Before proceeding, verify:

- [ ] Firebase project created
- [ ] Web app registered
- [ ] Email/Password authentication enabled
- [ ] Firestore database created (test mode)
- [ ] Cloud Storage bucket created (test mode)
- [ ] Firebase config copied
- [ ] `.env` file created with all values

---

## Next Steps

After completing the manual setup above, run the setup script I've provided to:
1. Install Firebase SDK packages
2. Create the Firebase configuration file
3. Create a test component to verify the connection

---

## Troubleshooting

### "Permission denied" errors
- Make sure Firestore is in test mode
- Check that your domain is in authorized domains

### "App not initialized" errors
- Verify all environment variables are set
- Restart your development server after changing `.env`

### Can't find config
- Go to Project Settings → Your apps → Web app → SDK setup

---

## Security Note

The test mode rules expire after 30 days. Before launch, update your Firestore rules in:
**Firestore Database** → **Rules**

We'll configure proper security rules in Phase 2 of the roadmap.
