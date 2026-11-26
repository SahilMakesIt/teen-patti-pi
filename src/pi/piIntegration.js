const AD_REWARD_CHIPS = 2500;
const BASE_PACK_CHIPS = 10000;
const BASE_PACK_PI = 0.25;
const STORAGE_PLAYER_ID_KEY = 'teen_patti_player_id';
const STORAGE_PIONEER_NAME_KEY = 'teen_patti_pioneer_name';

export function isPiBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof window.Pi !== 'undefined' &&
    typeof window.Pi.authenticate === 'function'
  );
}

export function isPiAdsSupported() {
  return (
    isPiBrowser() &&
    typeof window.Pi.Ads !== 'undefined' &&
    typeof window.Pi.Ads.showAd === 'function'
  );
}

export function isPiPaymentsSupported() {
  return isPiBrowser() && typeof window.Pi.createPayment === 'function';
}

export function getOrCreateGuestIdentity() {
  let storedId = null;
  let storedName = null;
  try {
    storedId = window.localStorage.getItem(STORAGE_PLAYER_ID_KEY);
    storedName = window.localStorage.getItem(STORAGE_PIONEER_NAME_KEY);
  } catch (_err) {
    // Ignore storage access errors
  }

  if (!storedId || !storedName) {
    const code = Math.floor(1000 + Math.random() * 9000);
    const suffix = Math.random().toString(36).slice(2, 10);
    storedId = storedId || `pioneer_${code}_${suffix}`;
    storedName = storedName || `Pioneer_${code}`;
    try {
      window.localStorage.setItem(STORAGE_PLAYER_ID_KEY, storedId);
      window.localStorage.setItem(STORAGE_PIONEER_NAME_KEY, storedName);
    } catch (_err) {
      // Ignore storage access errors
    }
  }

  return {
    playerId: storedId,
    username: storedName,
    uid: storedId,
    isPiAuthenticated: false,
    environmentLabel: `Guest Pioneer (${storedName})`
  };
}

export function onIncompletePaymentFound(_payment) {
  // Play Chips have zero real-world or monetary value.
}

export async function authenticateWithPi() {
  const guest = getOrCreateGuestIdentity();
  if (!isPiBrowser()) {
    return guest;
  }

  try {
    if (typeof window.Pi.init === 'function') {
      window.Pi.init({ version: '2.0', sandbox: false });
    }
    const authResult = await window.Pi.authenticate(
      ['username', 'payments'],
      onIncompletePaymentFound
    );
    const user = authResult?.user || {};
    const username = user.username || guest.username;
    try {
      if (user.username) {
        window.localStorage.setItem(STORAGE_PIONEER_NAME_KEY, user.username);
      }
    } catch (_err) {}

    return {
      playerId: guest.playerId,
      username,
      uid: user.uid || guest.playerId,
      isPiAuthenticated: Boolean(user.username),
      environmentLabel: user.username
        ? `Pi Wallet Connected (@${username})`
        : guest.environmentLabel
    };
  } catch (_err) {
    return guest;
  }
}

export async function verifyAndGrantAdReward(adId) {
  const resp = await fetch('/api/pi/ads/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adId })
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(payload.error || `Ad verification failed (HTTP ${resp.status})`);
  }
  const granted = payload?.mediator_ack_status === 'granted';
  return {
    granted,
    adId,
    mediator_ack_status: payload?.mediator_ack_status || 'rejected',
    chips: granted ? AD_REWARD_CHIPS : 0,
    reason: granted
      ? null
      : `Pi verify status: ${payload?.mediator_ack_status || 'not granted'}`
  };
}

export async function watchRewardedAdForChips({ onPreviewTick } = {}) {
  const tickCb = typeof onPreviewTick === 'function' ? onPreviewTick : () => {};

  if (isPiAdsSupported()) {
    let secs = 3;
    tickCb(secs);
    const timer = setInterval(() => {
      secs = Math.max(0, secs - 1);
      tickCb(secs);
    }, 1000);

    try {
      let showResult;
      if (typeof window.Pi.Ads.isAdReady === 'function') {
        const readiness = await window.Pi.Ads.isAdReady('rewarded');
        if (!readiness?.ready && typeof window.Pi.Ads.requestAd === 'function') {
          await window.Pi.Ads.requestAd('rewarded');
        }
      }
      showResult = await window.Pi.Ads.showAd('rewarded');
if (showResult?.result === 'AD_REWARDED') {
  if (showResult?.adId) {
    return await verifyAndGrantAdReward(showResult.adId);
  }
  return {
    granted: true,
    chips: AD_REWARD_CHIPS,
    adId: null,
    mediator_ack_status: 'granted'
  };
}
return {
  granted: false,
  adId: showResult?.adId || null,
  reason: showResult?.result
    ? `Ad not rewarded (${showResult.result}).`
    : 'Ad closed before reward completion.'
};
    } finally {
      clearInterval(timer);
    }
  }

  for (let secs = 3; secs >= 1; secs -= 1) {
    tickCb(secs);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  tickCb(0);
  return {
    granted: true,
    chips: AD_REWARD_CHIPS,
    adId: `preview_${Date.now()}`,
    mediator_ack_status: 'granted'
  };
}

async function approvePiPaymentOnServer(paymentId, metadata) {
  const resp = await fetch('/api/pi/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, metadata })
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Pi server approval failed (${resp.status})`);
  }
  return resp.json();
}

async function completePiPaymentOnServer(paymentId, txid, metadata) {
  const resp = await fetch('/api/pi/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, txid, metadata })
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Pi server completion failed (${resp.status})`);
  }
  return resp.json();
}

export async function createPiChipsPayment({ quantity = 1, playerId, isPiConnected = false }) {
  const safeQty = Math.max(1, Math.min(5, Math.floor(quantity)));
  const chips = BASE_PACK_CHIPS * safeQty;
  const piAmount = Number((BASE_PACK_PI * safeQty).toFixed(2));
  const memo = `${chips.toLocaleString('en-US')} Teen Patti Play Chips (Entertainment Only)`;
  const metadata = { chips, playerId, quantity: safeQty };

  if (!isPiPaymentsSupported()) {
    await new Promise((r) => setTimeout(r, 900));
    return {
      completed: true,
      chipsGranted: chips,
      piAmount,
      piUsername: null,
      message: `Preview Simulator: +${chips.toLocaleString('en-US')} Play Chips granted (${piAmount.toFixed(2)} Pi simulated via /api/pi/approve & /api/pi/complete).`
    };
  }

  let authUsername = null;
  if (!isPiConnected) {
    const authRes = await authenticateWithPi();
    if (authRes.isPiAuthenticated) {
      authUsername = authRes.username;
    }
  }

  return new Promise((resolve) => {
    window.Pi.createPayment(
      { amount: piAmount, memo, metadata },
      {
        onReadyForServerApproval: (paymentId) => approvePiPaymentOnServer(paymentId, metadata),
        onReadyForServerCompletion: async (paymentId, txid) => {
          try {
            await completePiPaymentOnServer(paymentId, txid, metadata);
            resolve({
              completed: true,
              chipsGranted: chips,
              piAmount,
              piUsername: authUsername,
              message: `+${chips.toLocaleString('en-US')} Play Chips added (${piAmount.toFixed(2)} Pi)!`
            });
          } catch (err) {
            resolve({
              completed: false,
              chipsGranted: 0,
              piAmount,
              piUsername: authUsername,
              message: err?.message || 'Payment completion verification failed.'
            });
          }
        },
        onCancel: () => {
          resolve({
            completed: false,
            chipsGranted: 0,
            piAmount,
            piUsername: authUsername,
            message: 'Pi payment cancelled.'
          });
        },
        onError: (err) => {
          resolve({
            completed: false,
            chipsGranted: 0,
            piAmount,
            piUsername: authUsername,
            message: err?.message || 'Pi payment failed.'
          });
        }
      }
    );
  });
}
