import { useState, useEffect, useMemo } from "react";

const COOLDOWN_MS = 5 * 60 * 1000;          // 5 minutes
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;   // 24 hours
const MAX_ADS_PER_24H = 7;

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function useRewardedAdCooldown(adHistory = []) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    const validHistory = (Array.isArray(adHistory) ? adHistory : [])
      .map((ts) => (typeof ts === "number" ? ts : ts?.toMillis?.() || 0))
      .filter((ts) => ts > 0 && now - ts < WINDOW_24H_MS)
      .sort((a, b) => a - b);

    const adsUsed = validHistory.length;
    const adsRemaining = Math.max(0, MAX_ADS_PER_24H - adsUsed);
    const lastAdAt = validHistory[validHistory.length - 1] || 0;

    let unlockAt = 0;
    let status = "READY";

    if (adsUsed >= MAX_ADS_PER_24H) {
      unlockAt = validHistory[0] + WINDOW_24H_MS;
      status = "DAILY_LIMIT";
    } else if (lastAdAt && now - lastAdAt < COOLDOWN_MS) {
      unlockAt = lastAdAt + COOLDOWN_MS;
      status = "COOLDOWN";
    }

    const remainingMs = Math.max(0, unlockAt - now);
    const canWatch = remainingMs === 0;

    let buttonText = `Watch Ad +Chips (${adsRemaining}/${MAX_ADS_PER_24H} left)`;
    if (!canWatch && status === "COOLDOWN") {
      buttonText = `Next Free Ad in ${formatDuration(remainingMs)} (${adsRemaining}/${MAX_ADS_PER_24H} left)`;
    } else if (!canWatch && status === "DAILY_LIMIT") {
      buttonText = `7/7 Used • Next Ad in ${formatDuration(remainingMs)}`;
    }

    const nextHistory = [...validHistory, now].slice(-MAX_ADS_PER_24H);

    return {
      canWatch,
      status,
      adsUsed,
      adsRemaining,
      remainingMs,
      buttonText,
      nextHistory,
    };
  }, [adHistory, now]);
}
