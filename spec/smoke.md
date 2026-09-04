# smoke.md — Manual Smoke Checklist

Run before every deploy. ~10 minutes. Catches what automated tests do not.

```
npm test && npm run build && vercel --prod
```

## 1. Build and config
- [ ] Build completes, zero errors, zero new warnings
- [ ] Environment variables (Gemini key, Supabase keys) are set in Vercel, not in a tracked file
- [ ] No secret appears in the built output (grep for your key prefix)

## 2. Cold start
Private window, no shared access code entered yet.
- [ ] Page loads, no console errors
- [ ] Entering the shared access code works and reaches the chat UI
- [ ] Hard refresh mid-conversation — nothing breaks

## 3. Core path
- [ ] Ask a real question matching known content — grounded answer + citation appears
- [ ] Ask a question outside the pilot subject's material — "not in my material" appears, not a generated guess
- [ ] The citation shown actually corresponds to real ingested content, spot-checked by eye

## 4. Cross-device
- [ ] Desktop Chrome
- [ ] One non-Chromium browser
- [ ] Mobile — no horizontal scroll, controls reachable
- [ ] 360px viewport

## 5. Accessibility
- [ ] Full keyboard traversal of the ask/answer flow
- [ ] Visible focus indicators
- [ ] Meaning not carried by colour alone (the "not in my material" state is legible without color)

## 6. Post-deploy
- [ ] Live URL serves the new build (check a changed string)
- [ ] Heartbeat cron is registered and its last run is recent (check Vercel Cron / GitHub Actions logs)
- [ ] Query-count telemetry incrementing on a real test question (M2 onward only)

---

## Failure protocol
1. **Roll back first:** revert to the previous Vercel deployment from the dashboard (or `vercel rollback`) — instant, do this before diagnosing
2. Reproduce locally
3. Add a test to `evals.md` that would have caught it
4. Fix
5. Re-run this checklist in full, not just the failed section

Every production bug adds an item to this file.
