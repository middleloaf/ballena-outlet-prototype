# Ballena Outlet — bilingual storefront prototype

A Spanish/English website for **Ballena Outlet**, a liquidation store in Uvita, Costa Rica that buys pallets of customer returns, overstock, and unclaimed packages from major U.S. retailers and sells the items by the piece.

- **Spanish site:** `index.html` (Costa Rica flag / ES)
- **English site:** `en.html` (U.S. flag / EN)
- **Shared design:** `styles.css`
- **Interactions:** `script.js` (mobile menu, reveals, FAQ behavior, feed labeling)
- **Assets:** `assets/` (storefront hero, real store photos, SVG brand logo, SVG favicon)

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/index.html` (Spanish) or `http://localhost:4173/en.html` (English).

## What's included

- Full bilingual copy with a persistent flag-based language switch.
- Store details: Plaza La Perla del Pacífico, next to Servicentro Ballena, upstairs from Farmacia Ballena, Uvita, Costa Rica.
- WhatsApp `6313 2925` shown on the main WhatsApp buttons, email `ballena.outletafacturacion@hotmail.com`, Facebook, Instagram, and TikTok links as buttons.
- Social feeds and buttons placed near the top. The feed order is Facebook, Instagram, TikTok. Facebook and Instagram show the latest reel because their page/profile plugins do not render reels reliably; TikTok uses the standalone embed iframe (avoids TikTok `embed.js` overload protection). Direct-profile fallbacks remain for all three.
- Real store photos in the “Un lugar real / A real place” section, with a provisional-photo disclaimer and a Google Maps location embed.
- Store pickup and in-store shipping messaging throughout; no online checkout.
- Product groups with clearer examples, how-it-works steps, value props, FAQ, and a mobile quick-action bar.
- Persistent prototype notice in both languages, a detailed “About this prototype” section, and `noindex` metadata so search engines do not treat the demo as final.

## Notes

- The live feeds and map require an internet connection and are subject to each platform's embed policies. If a feed is blocked, the direct profile link still works. Facebook and Instagram reels are embedded because their page/profile plugins currently omit or fail to render reels; update the reel URLs when a newer reel should be featured.
- No prices are hard-coded; availability is handled through WhatsApp and in store.
- The site is a static prototype; no build step is required.
