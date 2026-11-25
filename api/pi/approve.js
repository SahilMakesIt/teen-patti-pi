export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ error: 'Missing paymentId' });
  }

  const piApiKey = process.env.PI_API_KEY;
  if (!piApiKey) {
    return res.status(501).json({
      error: 'PI_API_KEY environment variable is not configured in Vercel.'
    });
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${piApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Pi approval error' });
  }
}
