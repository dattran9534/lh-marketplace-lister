# LH Marketplace Lister

An Edge (or Chrome) extension that pulls vehicles from lynnwoodhonda.com and fills Facebook Marketplace's **Vehicle for sale** form: photos, details, and a description in Dat's style. It never clicks Publish. You look it over and publish it yourself.

## What's new in 1.1

- **Post several at once.** Tick vehicles in the list and click **Post selected**. Each one opens in its own Facebook tab and fills itself.
- **Import a whole page.** Click the LH button on an inventory or search results page and it offers to import every vehicle on it.
- **AI descriptions.** Written in your voice, opening with your 📍 contact line. They use the dealer page plus the CARFAX report.
- **CARFAX, good news only.** The app reads the CARFAX report linked on the dealer page. Only positive facts go into the post (one owner, clean title, no accidents, service records, locally owned). Damage, extra owners and other negatives are left out, and the app shows you what was left out so you know before a buyer asks.
- **Photos sorted automatically.** AI labels each photo as exterior, detail, interior or other, then orders them exterior first. Engine bay, keys and papers go last.
- **Banner removed.** The Lynnwood Honda banner in the top right corner gets trimmed off any photo that has it.
- **Clean title box** ticks itself when CARFAX guarantees no title problems.
- **One-click updates** (see below).

## Install or upgrade to 1.1 (one last manual install)

1. Unzip `lh-marketplace-lister.zip` and copy its contents over your existing `lh-marketplace-lister` folder, replacing the old files. (Or unzip somewhere new.)
2. Go to `edge://extensions`, find **LH Marketplace Lister**, and click its **Reload** arrow. If you used a new folder, click **Load unpacked** and pick it instead.

Your saved vehicles and settings stay put. They live in Edge, not in the folder.

## Turn on AI (needed for AI descriptions and photo sorting)

1. Go to **console.anthropic.com**, sign up, add a few dollars of credit, and create an API key.
2. In the app, open **Settings**, paste the key, and click **Test**.

The key is stored only in Edge on this computer. A typical car costs well under a cent: a fast, cheap model sorts the photos and a stronger one writes the description. Without a key, everything else still works and descriptions use a simpler built-in version.

## One-click updates

When a new version is out, a blue bar appears at the top of the app. Click **Update now**:

- The first time, Edge asks you to pick a folder. Choose the `lh-marketplace-lister` folder you loaded (the one with `manifest.json`) and allow Edge to edit it.
- After that, updates download, install, and restart the extension by themselves. The app reopens when it's done.

You can also check by hand in **Settings → Updates**.

## Posting cars

1. On lynnwoodhonda.com, open a car (or the inventory page) and click the red **LH** button.
2. Click **Import the page I was on**. Or paste vehicle links into the box and click **Import**. Each car takes about 15 to 30 seconds while it reads the dealer page and CARFAX, checks photos, and writes the post.
3. Check photos, details, the history box and the description. **Rewrite with AI** gives you a fresh version.
4. Click **Post to Marketplace**, or tick several cars and click **Post selected**.
5. Each Facebook tab fills itself. The panel in the bottom right shows a check next to each field. Fix anything marked **!**, then click **Next** and **Publish**.
6. Back in the app, click **Mark as posted**.

## Settings

- **Opening line**: the first line of every description.
- **Remove the Lynnwood Honda banner**: on by default.
- **Default condition**: Excellent unless you change it.
- **Start filling as soon as Facebook opens**: on by default.
- **Fill the VIN on Facebook**: off by default. Facebook adds its own specs from a VIN, and in testing it showed the wrong engine size for a 2019 Pilot (1.5 instead of 3.5) with no way to edit it.
- **Fill the Location field**: off by default because Facebook already uses your location.

## Good to know

- Posting lots of listings in a few minutes can make Facebook slow you down. Five or six at a time is safer.
- Background tabs fill a bit slower because Edge saves power on tabs you're not looking at. Click into one if it seems stuck, or click **Autofill** in its panel.
- If Facebook changes its form, the panel shows which fields it couldn't fill so you can do those by hand.
