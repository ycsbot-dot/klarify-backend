import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';

// ── Routes
import authRouter from './routes/auth.js';
import subscriptionRouter from './routes/subscription.js';
import analyseRouter from './routes/analyse.js';
import webhookRouter from './routes/webhook.js';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Webhook MOET raw body ontvangen — vóór express.json()
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRouter);

// ── Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minuten
  max: 60,                    // max 60 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel verzoeken — probeer over 15 minuten opnieuw.' }
});
app.use('/api/', limiter);

// ── API routes
app.use('/api/auth', authRouter);
app.use('/api/subscription', subscriptionRouter);
app.use('/api/analyse', analyseRouter);

// ── Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Frontend serveren (optioneel — als u de HTML hier host)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Klarify backend draait op poort ${PORT}`);
  console.log(`Omgeving: ${process.env.NODE_ENV || 'development'}`);
});

export { stripe };
