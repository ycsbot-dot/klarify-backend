import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { findUserById, upsertUser } from '../middleware/users.js';
import { stripe } from '../server.js';

const router = Router();

/**
 * POST /api/subscription/checkout
 * Maak een Stripe Checkout sessie aan en stuur de URL terug.
 */
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const user = findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

    // Maak Stripe customer aan als die nog niet bestaat
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { klarifyUserId: user.id },
      });
      customerId = customer.id;
      upsertUser({ ...user, stripeCustomerId: customerId });
    }

    const type = req.body.type || 'sub'; // 'sub' | 'single'
    const isSingle = type === 'single';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card', 'ideal'],
      line_items: [{
        price: isSingle ? process.env.STRIPE_PRICE_ID_SINGLE : process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: isSingle ? 'payment' : 'subscription',
      success_url: (process.env.ALLOWED_ORIGIN || 'http://localhost:3000') + '?checkout=success&type=' + type,
      cancel_url:  (process.env.ALLOWED_ORIGIN || 'http://localhost:3000') + '?checkout=cancel',
      ...(isSingle ? {} : {
        subscription_data: {
          trial_period_days: 0,   // Geen trial — eerste doc is al gratis geweest
          metadata: { klarifyUserId: user.id },
        },
      }),
      locale: 'nl',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout fout:', err);
    res.status(500).json({ error: 'Kon betaalscherm niet aanmaken.' });
  }
});

/**
 * POST /api/subscription/portal
 * Stuur gebruiker naar Stripe Customer Portal (abonnement beheren / opzeggen).
 */
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const user = findUserById(req.user.userId);
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'Geen actief abonnement gevonden.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
      locale: 'nl',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal fout:', err);
    res.status(500).json({ error: 'Kon abonnementsbeheer niet openen.' });
  }
});

/**
 * GET /api/subscription/status
 * Haal de huidige abonnementsstatus op.
 */
router.get('/status', requireAuth, async (req, res) => {
  const user = findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  res.json({
    status: user.stripeStatus || null,
    freeAnalysesLeft: user.freeAnalysesLeft || 0,
    hasAccess: user.stripeStatus === 'active' ||
               user.stripeStatus === 'trialing' ||
               (user.freeAnalysesLeft || 0) > 0,
  });
});

export default router;
