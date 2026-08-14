# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Environment variables

### Cloud Functions (`functions/`)

| Variable | Used by | Required? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `generateMealPlan` — AI meal planning (roadmap 7.2) | No. Without it the planner still builds a week from what is expiring in the kitchen and tells the cook the AI was skipped. |
| `LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH` | `syncLegacyRecipes` | Only for the legacy recipe import |

`ANTHROPIC_API_KEY` is a GitHub Actions secret in CI. For a deployment configured
the older way, `firebase functions:config:set anthropic.key=...` is read as a
fallback. Never commit a key or print one in a log.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

---

## CSV bulk import (roadmap 3.3)

Inventory can be stocked from a spreadsheet instead of one item at a time.
**Inventory → Import CSV** parses and validates the file in the browser, shows
which rows will import and what is wrong with the rest, then writes the good
ones in batches of 500 (Firestore's per-batch limit) and logs the run to
`users/{uid}/importHistory`.

### File format

The first line names the columns. Headings are matched case-insensitively and
accept common synonyms (`Item`/`Product` for `name`, `Qty`/`Amount` for
`quantity`); columns we don't recognise are ignored.

| Column | Required | Notes |
| --- | --- | --- |
| `name` | yes | Trimmed to 80 characters |
| `quantity` | yes | Must be greater than 0; `1,200` is read as 1200 |
| `location` | yes | One of your own labels ("Main Fridge") or a type ("fridge", "freezer", "pantry") |
| `unit` | no | Free text — `lbs`, `gal`, `bags` |
| `notes` | no | Trimmed to 200 characters |
| `shelfLifeDays` | no | Positive number of days, up to 3650 |
| `expiresAt` | no | Any date the browser can parse; otherwise the expiry is calculated from shelf life |
| `price`, `store` | no | Recorded in the item's purchase history |

```csv
name,quantity,unit,location,notes
Whole Milk,1,gal,Main Fridge,
Chicken Breast,2,lbs,Freezer,From Costco
Basmati Rice,5,lbs,Pantry,
```

Files of more than 5,000 rows are rejected — split them.

### Importing from a script

The same import is available server-side as the `importInventoryFromCSV` HTTP
Cloud Function, for automation and files too large to want a browser tab open
for:

```bash
curl -X POST "$FUNCTIONS_URL/importInventoryFromCSV" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -d '{"userId":"<uid>","fileName":"kitchen.csv","csvData":"name,quantity,location\nMilk,1,Main Fridge"}'
```

When an `Authorization: Bearer <Firebase ID token>` header is present the import
runs against the token's account, ignoring `userId` in the body. It needs no new
environment variables.
