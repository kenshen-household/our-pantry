# Our Pantry 🥫

A small web app for the two of us to:

- **Track the pantry**: what we have, how much, where it lives, what's running low or expiring.
- **Keep a cookbook**: every recipe shows ✅ / ❌ for each ingredient based on what's in the pantry, and you can filter to "only what we can make now".
- **Shop**: a shared shopping list, plus an automatic "running low" list. "Bought it" tops the pantry back up.
- **Cook**: "We cooked this" subtracts the ingredients from the pantry.

No server, no database, no build step. It's three plain files (`index.html`, `style.css`, `app.js`) and the data lives in this repo as two JSON files:

| File | What's in it |
|---|---|
| `data/pantry.json` | pantry items and the shopping list |
| `data/recipes.json` | the cookbook |

Every change either of you makes becomes a commit, so the repo's history is a full log of who added what and when (and you can undo anything from GitHub).

---

## One-time setup

### 1. Put the code on GitHub

1. Sign in to GitHub and click **New repository**. Name it `our-pantry`. Choose **Public** (see the privacy note below) and create it.
2. On the new repo page click **uploading an existing file**, drag in `index.html`, `style.css`, `app.js`, `README.md` **and the `data` folder**, then click **Commit changes**.

### 2. Turn on the website (GitHub Pages)

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
3. After a minute, the page shows your link, something like `https://YOUR-USERNAME.github.io/our-pantry/`. Bookmark it on both phones (on a phone you can also use "Add to Home Screen").

### 3. Give your wife access

Repo **Settings → Collaborators → Add people**, enter her GitHub username. She accepts the invite from her email.

### 4. Each of you makes a token (so the app can save)

A token is like a password that only lets the app edit this one repo. Each person makes their own.

1. GitHub → your profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `Our Pantry`. Expiration: pick one (a year is fine; you'll just repeat this when it expires).
3. **Resource owner**: the account that owns the repo. **Repository access**: *Only select repositories* → `our-pantry`.
4. **Permissions → Repository permissions → Contents: Read and write**. Nothing else.
5. Generate, and copy the token (it starts with `github_pat_`).

> **If your wife can't pick the repo** in step 3: fine-grained tokens can only reach repos owned by your own account or by an organization you belong to. Two easy fixes:
> - **Recommended:** create a free GitHub *organization* (profile picture → Your organizations → New organization → Free), invite her, and move the repo there (repo Settings → Transfer). Then both of you choose the organization as Resource owner.
> - Or she can use a **classic** token with only the `public_repo` box ticked (that token can edit any public repo she has access to, so it's broader).

### 5. Connect the app

Open the app, go to the **Settings** tab, and fill in:

- **Your first name** (shows up in commit messages, e.g. "Sam: Add Rice")
- **GitHub owner**: your username (or the organization name)
- **Repository name**: `our-pantry`
- **Branch**: `main`
- **Token**: the one you just made

Click **Save & connect**. The status line turns green. Do this once on each phone/computer.

The token is stored only in that browser. It is never saved into the repo.

---

## Using it

- **Pantry**: `+`/`−` buttons change counts instantly. Set "Warn me at or below" on things you never want to run out of.
- **Cookbook → + Add recipe**: type ingredients one per line, the way you'd write them:
  ```
  1 1/2 cup flour
  2 eggs
  3 cloves garlic
  parmesan (optional)
  ```
  The app reads the amount, unit and name, and matches the name to the pantry ("eggs" matches "Eggs", "rice" matches "Brown rice").
- **Cooking subtracts automatically** when the recipe and the pantry use the same unit (cups and cups, cans and cans). If they differ (recipe says "3 tbsp butter", pantry counts "sticks"), it tells you to adjust that one yourself.
- **Two people at once**: each save grabs the newest copy from GitHub first, so you won't overwrite each other. Press **↻ Refresh** (or just switch back to the app) to see the other person's changes.

## Privacy note

GitHub Pages on a free account needs the repo to be **public**, which means anyone with the link could see your pantry list and recipes (they **can't** change anything without a token). If you'd rather keep it private:

- Make the repo **private** and simply open `index.html` from your computer, or
- Use GitHub Pro (Pages works with private repos).

The app reads and writes through GitHub's API either way, so it works the same.

## Changing the app

It's plain HTML/CSS/JavaScript, no tools needed. `app.js` is split into numbered sections with comments. Some easy tweaks:

- **Locations** (Pantry, Fridge, …): `LOCATIONS` near the top of `app.js`.
- **Category suggestions**: `DEFAULT_CATEGORIES` right below it.
- **Colors**: the variables at the top of `style.css`.

Edit a file right on GitHub (pencil icon → Commit), and the site updates in about a minute.

To try it on your computer without GitHub, open `index.html` in a browser. Changes are then saved in that browser only.

## Starting fresh

The app ships with sample items and three sample recipes. To clear them, edit the files on GitHub:

- `data/pantry.json` → `{ "items": [], "shopping": [] }`
- `data/recipes.json` → `{ "recipes": [] }`
