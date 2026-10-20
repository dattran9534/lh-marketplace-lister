# LH Marketplace Lister

An Edge (or Chrome) extension that pulls vehicles from lynnwoodhonda.com and fills Facebook Marketplace's **Vehicle for sale** form: photos, details, and a description in Dat's style. It never clicks Publish. You look it over and publish it yourself.

## What's new in 1.9.1

- **Phone requests can't get stuck anymore.** If an import or other request stops before it finishes (the tab closed, Edge restarted, the extension updated), the PC marks it as stopped within a minute and the phone shows **Try again**. Imports also give up after 6 minutes and say which step they were stuck on, and every download and AI call now has a time limit.
- **Cancel and Try again on the phone.** Each request in the status box has **Cancel** while it's waiting or running, and **Try again** if it didn't work.
- Phone requests still go through even if another part of the sync hits an error.

## What's new in 1.9

- **Descriptions about this car, not any car.** The AI now leads with what's unusual about each vehicle: super low miles for its age (a 2007 Fit with 62k gets "about 3,200 miles a year when most cars do 12,000"), one owner, clean title with no accidents, clean condition, sold and serviced here, AWD, great MPG, a manual, CarPlay on an older car. Filler like "perfect for the Pacific Northwest" or "making it a great choice" is cut.
- **Better photo import from the phone.** Photos are read from the dealer page's full list in the dealer's order, so a background import no longer gets 2 photos or the wrong first photo.
- **Banner hidden on iPhone too.** The phone app now trims the Lynnwood Honda banner in previews (the PC already did). Facebook always gets the trimmed photos.
- **Refresh from dealer site** on the phone re-imports a car with the new photo and description rules.
- **Safe posting pace.** Cars post one at a time, 3 to 8 minutes apart, up to 5 new posts a day (change it in Settings). Extra cars wait in a posting line shown on the dashboard, with **Cancel line**. Facebook form filling also moves at a more human speed.
- **No double posts.** If a car is already Active or Pending on Facebook, the app skips it (on the PC you can choose to post anyway).
- **Gentler renewing.** At most 10 renewals per run, 6 to 15 seconds apart.

## What's new in 1.8.1 (phone app)

- **No more blinking.** The car boxes update in place instead of redrawing every refresh.
- **Live status.** A status box at the top shows what your PC is doing step by step (reading the dealer page, CARFAX, photos, writing the description, posting), then a ✓ or what went wrong.
- **Auto post and Auto renew switches on the phone.** They stay in step with the PC switches through your account; whichever you changed last wins.

## What's new in 1.8

- **Auto renew.** Turn on **Auto renew** on the dashboard and, once a day between 9am and 7pm, the extension opens Facebook's "Renew listings" screen in a background tab and renews every car listing that's ready (Facebook allows it about once a week per listing). Non-car listings, like parts, are left alone. **Renew now** does it right away, and the phone menu has **Ask PC to renew listings**. Edge needs to be open on the PC.
- **Shorter CPO line.** Certified cars now just say "Honda True Certified with warranty through 2031." (no miles or terms).

## What's new in 1.7

- **Learns from your best Facebook posts, including ones made before the app.** After each sync, the app reads the descriptions of your top three posts by clicks per day straight from Facebook (read only, in background tabs, nothing is changed) and the AI uses them as examples of what gets clicks. It re-reads them every two weeks. You can also click **Learn from my best posts** on the dashboard.

## What's new in 1.6

- **Update photos on live posts.** On the dashboard, a live car's box has **Update photos**; the vehicle editor has **Update photos on Facebook**. It replaces the photos on Facebook with the ones selected in the app, in your order, with the dealer banner trimmed. On the phone: open a car, **Edit photos** (tap to show or hide, ◀ Earlier, ★ First), **Save order**, then **Update photos on Facebook**. Works for cars that are in the app; listings you made before the app need importing first.
- **AI that learns what gets leads.** Descriptions now follow lead-focused rules (the first two or three lines carry the best selling points because that's all Facebook shows before "See more", buyer search words, no hype). The AI also studies your three best posts by clicks per day from your last Facebook sync, and any description you rewrote yourself. The editor shows which posts it learned from. Re-importing a car keeps your own rewrite.
- **Phone app doesn't zoom.** No pinch zoom, double tap zoom, or zooming in when you tap a text box.

## What's new in 1.5: the iPhone app

LH Lister for iPhone lives at **https://dattran9534.github.io/lh-marketplace-lister/**. Open it in Safari, tap Share, then **Add to Home Screen**. From the phone you can:

- See every car as a box, with Active / Pending / Sold / Not posted and clicks.
- Change prices, Mark sold / pending / available, Delete, and Post to Facebook.
- Take or pick photos and add them to a car. They show up on the PC and get posted with the car.
- Edit descriptions.
- Add a car by pasting a lynnwoodhonda.com link.

Anything that happens on Facebook is done by your PC: the phone sends the request, and the PC carries it out the next time Edge is open (the phone shows "PC online" or when it was last seen). Prices on cars that aren't on Facebook yet, photos and descriptions change right away.

### One time setup

1. In Supabase, open **SQL Editor**, paste everything from `cloud/setup.sql` (in the extension folder), and click **Run**.
2. In the PC app, open **Settings → Phone app**, paste the project URL and publishable key, enter your email and a password, and click **Create account**. Confirm the email Supabase sends, then click **Sign in**.
3. In Supabase, go to **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can make an account in your project.
4. On the iPhone, open the link above in Safari, sign in with the same email and password, then Share → **Add to Home Screen**.

The free Supabase plan includes 500 MB of data and 1 GB of photos. It pauses a project after 7 days with no use; if that ever happens, open supabase.com and click **Restore**.

## What's new in 1.4

- **Fixed: Mark sold and Delete.** The app now finds Facebook's confirm buttons even when other dialogs (chats, notifications) are open, answers Facebook's follow-up questions, and checks that the change really happened. If Facebook shows something unexpected, the box tells you what it said.
- **Fixed: Auto post.** It now clicks Next and Publish (Facebook labels those buttons twice, which the old version missed), and it starts by itself right after you import a car. It only stops if a must-have field (type, year, make, model, mileage, price, photos) didn't fill.
- **Works in the background.** Posting, price changes and Mark/Delete open Facebook in a tab behind the one you're on, so you can keep working. "Full sync" still opens in front for a moment because Facebook only loads older listings in a visible tab.
- **Auto refresh.** After a price change or Mark/Delete, the dashboard refreshes from Facebook by itself. If you edit a listing on Facebook directly, the dashboard picks up the change the next time you open your selling page.
- **Honda True Certified.** When the dealer page shows the Honda True Certified badge, the description says so, with Honda's 7 year/100,000 mile powertrain warranty and the date it runs to (7 years from the first sale date on the CARFAX).
- **Add your own photos.** In the vehicle editor, click "Add your photos" or drag photos onto the grid. To use iPhone photos on your PC, turn on iCloud Photos on the iPhone and install iCloud for Windows; your photos then show up in the "iCloud Photos" folder on the PC.

## What's new in 1.3

- **Dashboard home page.** Every car shows as a box: photo, price, miles, status (Not posted, Active, Pending, Sold), listed date and clicks, plus totals at the top.
- **Sync with Facebook.** Reads all your vehicle listings from your Facebook selling page and matches them to the cars in the app. Listings you made before the app show up too, marked "On Facebook only".
- **Change price** right on a box. If the car is live on Facebook, the new price is saved on Facebook too.
- **Mark sold, Mark pending, Mark available, Delete** for any Facebook listing, from its box. Delete always asks first.
- **Auto post switch.** When on, a listing publishes by itself right after it fills in, but only if every field filled without a problem. When off (the default), you review and publish yourself.
- **"Well serviced"** instead of a number of service records in descriptions.
- **First photo** is now the waterfront front three quarter shot.

### How the Facebook actions work

Sync, price changes and the Mark / Delete buttons open your Facebook selling page in a tab for a few seconds, click Facebook's own buttons (the same ones you'd click), then close the tab and bring you back. Stay logged in to Facebook in Edge. If Facebook changes its pages, the box tells you what didn't work.

## What's new in 1.2

- **Free AI.** Descriptions and photo sorting now run on Google Gemini's free tier.
- **Update now** only shows when there's actually a new version (top bar and Settings).

## What's new in 1.1

- **Post several at once.** Tick vehicles in the list and click **Post selected**. Each one opens in its own Facebook tab and fills itself.
- **Import a whole page.** Click the LH button on an inventory or search results page and it offers to import every vehicle on it.
- **AI descriptions.** Written in your voice, opening with your 📍 contact line. They use the dealer page plus the CARFAX report.
- **CARFAX, good news only.** The app reads the CARFAX report linked on the dealer page. Only positive facts go into the post (one owner, clean title, no accidents, service records, locally owned). Damage, extra owners and other negatives are left out, and the app shows you what was left out so you know before a buyer asks.
- **Photos sorted automatically.** AI labels each photo as exterior, detail, interior or other, then orders them exterior first. Engine bay, keys and papers go last.
- **Banner removed.** The Lynnwood Honda banner in the top right corner gets trimmed off any photo that has it.
- **Clean title box** ticks itself when CARFAX guarantees no title problems.
- **One-click updates** (see below).

## Install

1. Unzip `lh-marketplace-lister.zip` and copy its contents over your existing `lh-marketplace-lister` folder, replacing the old files. (Or unzip somewhere new.)
2. Go to `edge://extensions`, find **LH Marketplace Lister**, and click its **Reload** arrow. If you used a new folder, click **Load unpacked** and pick it instead.

Your saved vehicles and settings stay put. They live in Edge, not in the folder.

## Turn on AI (free)

AI writes the descriptions and sorts the photos. It uses Google Gemini's free tier, so it costs nothing.

1. Go to **aistudio.google.com**, sign in with a Google account, and click **Get API key**, then **Create API key**. No credit card needed.
2. In the app, open **Settings**, keep **AI provider** on **Google Gemini (free)**, paste the key, and click **Test**.

The free tier has a daily limit (reported around 500 requests a day for the model the app falls back to). Each car uses 2, so a normal day is well within it. If it ever runs out, the app uses its built-in writer until the limit resets at midnight Pacific.

Google says free tier requests may be used to improve its products and can be read by reviewers. The app only sends what you're about to post publicly anyway: the car's details, the positive CARFAX facts, and small copies of the photos.

Prefer Claude? Switch **AI provider** to **Anthropic Claude (paid)** and use a key from console.anthropic.com.

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
