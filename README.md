# Teen Patti Web App (Vercel + Pi Browser)

Single-page React + Vite web version of Teen Patti connected to the shared `teen-patti-pi` Firebase Firestore database (`ai-studio-android-teenpatt-40f016a0-2258-4001-a4b3-a545bea9020f`).

## Deploy to Vercel
1. Push this repository (or export the `web-vercel/` folder) to GitHub.
2. In Vercel, import the project and set **Root Directory** to `web-vercel` (Framework Preset: **Vite**).
3. Add Environment Variable `PI_API_KEY` in Vercel Project Settings -> Environment Variables so `/api/pi/approve`, `/api/pi/complete`, and `/api/pi/ads/verify` can authenticate with `https://api.minepi.com/v2` inside Pi Browser.
4. Deploy and open the generated `https://<your-app>.vercel.app` URL inside Pi Browser.
