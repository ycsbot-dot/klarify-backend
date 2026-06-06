import { Router } from 'express';
import { stripe } from '../server.js';
import { findUserByStripeCustomer, updateStripeStatus } from '../middleware/users.js';

const router = Router();

/**
 * POST /webhook
 * Stripe stuurt events naar dit endpoint.
 * Configureer de webhook URL in Stripe Dashboard → Developers → Webhooks.
 */
router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verificatie mislukt:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Stripe event ontvangen: ${event.type}`);

  switch (event.type) {

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const user = findUserByStripeCustomer(sub.customer);
      if (user) {
        updateStripeStatus(user.id, sub.status, sub.id);
        console.log(`Abonnement ${sub.status} voor ${user.email}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = findUserByStripeCustomer(sub.customer);
      if (user) {
        updateStripeStatus(user.id, 'canceled', sub.id);
        console.log(`Abonnement opgezegd voor ${user.email}`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const user = findUserByStripeCustomer(invoice.customer);
      if (user) {
        updateStripeStatus(user.id, 'past_due', null);
        console.log(`Betaling mislukt voor ${user.email}`);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const user = findUserByStripeCustomer(invoice.customer);
      if (user) {
        updateStripeStatus(user.id, 'active', null);
        console.log(`Betaling succesvol voor ${user.email}`);
      }
      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object;
      // Status wordt ook via subscription.updated ontvangen
      console.log(`Checkout voltooid: ${session.customer_email}`);
      break;
    }

    default:
      // Onbekende events negeren
      break;
  }

  res.json({ received: true });
});

export default router;
