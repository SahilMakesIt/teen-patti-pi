import admin from 'firebase-admin';

const MAX_DAILY_GIFT_CHIPS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VIDEO_REWARD_CHIPS = 2000;

const PI_PACKS = {
  1: 10000,
  2: 25000,
  5: 75000,
  10: 200000
};

function getDb() {
  if (!admin.apps.length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) {
      throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable');
    }
    const serviceAccount = JSON.parse(rawServiceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const dbId = process.env.FIRESTORE_DATABASE_ID;
  return dbId ? admin.firestore(dbId) : admin.firestore();
}

async function verifyPiAccessToken(piAccessToken) {
  if (!piAccessToken) return null;
  const res = await fetch('https://api.minepi.com/v2/me', {
    headers: { Authorization: `Bearer ${piAccessToken}` }
  });
  if (!res.ok) return null;
  return res.json();
}

async function verifyPiPayment(paymentId, txid) {
  const apiKey = process.env.PI_API_KEY;
  if (!apiKey || !paymentId) return false;
  const res = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Key ${apiKey}` }
  });
  if (!res.ok) return false;
  const payment = await res.json();
  const completed = Boolean(payment?.status?.developer_completed || payment?.transaction?.verified);
  if (!completed) return false;
  if (txid && payment?.transaction?.txid && payment.transaction.txid !== txid) {
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) {
      return res.status(401).json({ error: 'Missing Firebase ID token' });
    }

    const db = getDb();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;

    const { action, targetUid, recipientInput, amount, quantity, paymentId, txid, piAccessToken } =
      req.body || {};

    const actorUid = targetUid || callerUid;

    if (action === 'ad_reward') {
      const userRef = db.collection('users').doc(actorUid);
      const nextBalance = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User profile not found');
        const current = Number(snap.data().chipsBalance || 0);
        const updated = current + VIDEO_REWARD_CHIPS;
        tx.update(userRef, {
          chipsBalance: updated,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.set(db.collection('admin_logs').doc(), {
          type: 'AD_REWARD',
          callerUid,
          userId: actorUid,
          amount: VIDEO_REWARD_CHIPS,
          chipsBalanceAfter: updated,
          createdAtMs: Date.now(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return updated;
      });
      return res.status(200).json({ ok: true, chipsBalance: nextBalance, granted: VIDEO_REWARD_CHIPS });
    }

    if (action === 'pi_purchase') {
      const qty = Number(quantity);
      const granted = PI_PACKS[qty];
      if (!granted) {
        return res.status(400).json({ error: 'Invalid Pi chip pack quantity' });
      }
      const validPayment = await verifyPiPayment(paymentId, txid);
      if (!validPayment) {
        return res.status(400).json({ error: 'Pi payment verification failed' });
      }
      if (piAccessToken) {
        const me = await verifyPiAccessToken(piAccessToken);
        if (!me?.username) {
          return res.status(401).json({ error: 'Invalid Pi access token' });
        }
      }

      const userRef = db.collection('users').doc(actorUid);
      const nextBalance = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('User profile not found');
        const current = Number(snap.data().chipsBalance || 0);
        const updated = current + granted;
        tx.update(userRef, {
          chipsBalance: updated,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.set(db.collection('admin_logs').doc(), {
          type: 'PI_CHIP_PURCHASE',
          callerUid,
          userId: actorUid,
          paymentId,
          txid: txid || null,
          amount: granted,
          chipsBalanceAfter: updated,
          createdAtMs: Date.now(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return updated;
      });
      return res.status(200).json({ ok: true, chipsBalance: nextBalance, granted });
    }

    if (action === 'gift_transfer') {
      const cleanRecipient = String(recipientInput || '').trim().replace(/^@/, '');
      const giftAmount = Math.floor(Number(amount));
      if (!cleanRecipient || !Number.isFinite(giftAmount) || giftAmount < 100 || giftAmount > MAX_DAILY_GIFT_CHIPS) {
        return res.status(400).json({ error: 'Gift must be between 100 and 50,000 chips' });
      }

      let recipientDoc = await db.collection('users').doc(cleanRecipient).get();
      if (!recipientDoc.exists) {
        const byName = await db
          .collection('users')
          .where('pioneerName', '==', cleanRecipient)
          .limit(1)
          .get();
        if (!byName.empty) recipientDoc = byName.docs[0];
      }
      if (!recipientDoc.exists) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      const recipientUid = recipientDoc.id;
      if (recipientUid === actorUid) {
        return res.status(400).json({ error: 'Cannot gift chips to yourself' });
      }

      const cutoffMs = Date.now() - DAY_MS;
      const [sentSnap, recvSnap] = await Promise.all([
        db.collection('gift_transfers').where('senderUid', '==', actorUid).get(),
        db.collection('gift_transfers').where('recipientUid', '==', recipientUid).get()
      ]);

      const sent24h = sentSnap.docs.reduce(
        (sum, d) => ((d.data().createdAtMs || 0) >= cutoffMs ? sum + Number(d.data().amount || 0) : sum),
        0
      );
      const recv24h = recvSnap.docs.reduce(
        (sum, d) => ((d.data().createdAtMs || 0) >= cutoffMs ? sum + Number(d.data().amount || 0) : sum),
        0
      );

      if (sent24h + giftAmount > MAX_DAILY_GIFT_CHIPS) {
        return res.status(400).json({ error: 'Sender 24h gift limit (50,000) exceeded' });
      }
      if (recv24h + giftAmount > MAX_DAILY_GIFT_CHIPS) {
        return res.status(400).json({ error: 'Recipient 24h gift limit (50,000) exceeded' });
      }

      const senderRef = db.collection('users').doc(actorUid);
      const recvRef = db.collection('users').doc(recipientUid);
      const transferRef = db.collection('gift_transfers').doc();

      const updatedSenderChips = await db.runTransaction(async (tx) => {
        const [sSnap, rSnap] = await Promise.all([tx.get(senderRef), tx.get(recvRef)]);
        if (!sSnap.exists || !rSnap.exists) throw new Error('Account missing');
        const sChips = Number(sSnap.data().chipsBalance || 0);
        const rChips = Number(rSnap.data().chipsBalance || 0);
        if (sChips < giftAmount) throw new Error('Insufficient chips');

        const nextSender = sChips - giftAmount;
        const nextRecv = rChips + giftAmount;
        const nowMs = Date.now();

        tx.update(senderRef, {
          chipsBalance: nextSender,
          totalGiftsSent: admin.firestore.FieldValue.increment(giftAmount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.update(recvRef, {
          chipsBalance: nextRecv,
          totalGiftsReceived: admin.firestore.FieldValue.increment(giftAmount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.set(transferRef, {
          senderUid: actorUid,
          senderName: sSnap.data().pioneerName || actorUid,
          recipientUid,
          recipientName: rSnap.data().pioneerName || recipientUid,
          amount: giftAmount,
          status: 'completed',
          createdAtMs: nowMs,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return nextSender;
      });

      return res.status(200).json({
        ok: true,
        chipsBalance: updatedSenderChips,
        recipientName: recipientDoc.data().pioneerName || recipientUid,
        amount: giftAmount
      });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Server error' });
  }
}
