# Frontend configuration

The frontend reads the backend URL from `VITE_API_URL`.

For local development:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

For Vercel, add `VITE_API_URL` in the project Environment Variables and set it
to the public Render backend URL, for example
`https://your-render-backend.onrender.com`. Vite injects this value at build
time, so redeploy after changing it. Do not commit `.env`.
