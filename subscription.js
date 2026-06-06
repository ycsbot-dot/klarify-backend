import { Router } from 'express';
import { requireAuth, requireSubscription } from '../middleware/auth.js';
import { findUserById, decrementFreeAnalysis, makeToken } from '../middleware/users.js';
import { makeToken as mkToken } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/analyse/direct
 * Body: { prompt: '<vrije tekst prompt>' }
 * Stuur een willekeurige prompt naar Claude en geef de tekst terug.
 * Gebruikt voor brief genereren, schuldsanering, belscript etc.
 */
router.post('/direct', requireAuth, requireSubscription, async (req, res) => {
  const { prompt, maxTokens } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Geen prompt meegegeven.' });

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], maxTokens || 2000);
    res.json({ text });
  } catch (err) {
    console.error('Direct analyse fout:', err);
    res.status(500).json({ error: 'Analyse mislukt. Probeer opnieuw.' });
  }
});

/**
 * POST /api/analyse/ocr
 * Body: { image: '<base64>', mediaType: 'image/jpeg' }
 * Stuurt de afbeelding door naar Claude Vision voor OCR.
 */
router.post('/ocr', requireAuth, requireSubscription, async (req, res) => {
  const { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: 'Geen afbeelding meegegeven.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: 'Lees ALLE tekst letterlijk over uit dit document, inclusief kleine lettertjes, voetnoten, bedragen, datums en referentienummers. Bewaar de structuur. Geef alleen de tekst terug, geen commentaar.',
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'API fout.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Verlaag gratis teller als van toepassing
    const user = findUserById(req.user.userId);
    if (user && !['active', 'trialing'].includes(user.stripeStatus)) {
      decrementFreeAnalysis(req.user.userId);
      // Stuur vers token mee zodat frontend de teller update
      const freshToken = mkToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        stripeStatus: user.stripeStatus,
        freeAnalysesLeft: Math.max(0, (user.freeAnalysesLeft || 1) - 1),
      });
      res.setHeader('X-Fresh-Token', freshToken);
    }

    res.json({ text });
  } catch (err) {
    console.error('OCR fout:', err);
    res.status(500).json({ error: 'OCR mislukt.' });
  }
});

/**
 * POST /api/analyse/document
 * Body: { text: '<documenttekst>', aanmaning: 'ja|nee|onbekend|geen-incasso' }
 * Analyseert het document en geeft JSON-rapport terug.
 */
router.post('/document', requireAuth, requireSubscription, async (req, res) => {
  const { text, aanmaning, existingType } = req.body;
  if (!text) return res.status(400).json({ error: 'Geen tekst meegegeven.' });

  // Type detectie prompt (snel en goedkoop)
  let type = existingType || 'overig';
  if (!existingType) {
    try {
      const typeRes = await callClaude([{
        role: 'user',
        content: `Classificeer dit document: schuld, huur, werk, koop, zorg, of overig. Antwoord met alleen dat woord.\n\n${text.slice(0, 1200)}`,
      }], 20);
      const raw = typeRes.toLowerCase().replace(/[^a-z]/g, '');
      const VALID = ['schuld','huur','werk','koop','zorg','overig'];
      if (VALID.includes(raw)) type = raw;
    } catch (e) { /* gebruik default */ }
  }

  // Volledige analyse prompt
  const CHECKS = {
    schuld: ['Hoofdsom / oorspronkelijke schuld','Aanmaning vóór incassokosten (art. 6:96 lid 6 BW)','BIK incassokosten — WIK-maximum','Administratiekosten rechtmatig?','Rentecalculatie correct (art. 6:119 BW)','Dreiging BKR of deurwaarder rechtmatig?'],
    huur:   ['Huurprijs binnen wettelijke grenzen (WWS)','Borgsom maximaal 2 maanden (wet 2023)','Opzegtermijn correct','Servicekosten gespecificeerd','Geen illegale clausules','Onderhoudsplicht correct'],
    werk:   ['Salaris boven wettelijk minimumloon','Proeftijd maximaal 2 maanden','Non-concurrentiebeding rechtsgeldig','Ontslagprocedure correct','Vakantiedagen en -geld correct','Contracttype duidelijk'],
    koop:   ['Ontbindende voorwaarden aanwezig','Bedenktijd 3 dagen (art. 7:2 BW)','Verborgen gebreken regeling','Eigendomsoverdracht geregeld','Koopprijs en betaalconditie','Garanties na aankoop'],
    zorg:   ['Vergoeding conform basisverzekering','Eigen risico correct (2025: €385)','Machtigingsvereiste gerechtvaardigd','Afwijzing voldoende gemotiveerd','Bezwaartermijn niet verstreken','Zorgaanbieder gecontracteerd'],
    overig: ['Deadlines en vervaltermijnen','Verplichtingen beide partijen','Onredelijke bepalingen','Bezwaarmogelijkheden','Bevoegde instantie','Rechtsgeldig gesloten'],
  };

  const checks = CHECKS[type] || CHECKS.overig;
  const aanmCtx = aanmaning === 'nee'
    ? '\n\nCRUCIAAL: Geen eerdere aanmaning — BIK waarschijnlijk niet verschuldigd (art. 6:96 lid 6 BW). Benadruk dit prominent.'
    : aanmaning === 'ja' ? '\n\nAanmaning ontvangen. Controleer of BIK-bedrag wettelijk maximum niet overschrijdt.' : '';

  const prompt = `Analyseer dit ${type} voor een particulier. Geef resultaat als valide JSON:

{"type":"${type}","samenvatting":"3-4 zinnen","urgentie":"LAAG|MIDDEL|HOOG|KRITIEK","urgentie_reden":"kort","urgentie_geruststelling":"één geruststellende zin","geruststelling":"persoonlijke zin","checks":[{"n":1,"titel":"${checks[0]}","status":"GROEN|ORANJE|ROOD","badge":"max 3 woorden","fragment":"exacte tekst uit document max 120 tekens of lege string","uitleg":"wat staat er en of het correct is met wetsverwijzing","actie":"concrete stap"}],"acties":[{"nr":1,"titel":"","omschrijving":"","deadline":"of leeg"}]}${aanmCtx}

${checks.map((c, i) => `Check ${i + 1}: ${c}`).join('\n')}

Geef ALLEEN de JSON.
---
${text}`;

  try {
    const rawJson = await callClaude([{ role: 'user', content: prompt }], 3000);
    const clean = rawJson.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const analyse = JSON.parse(clean);

    // Verlaag gratis teller
    const user = findUserById(req.user.userId);
    if (user && !['active', 'trialing'].includes(user.stripeStatus)) {
      decrementFreeAnalysis(req.user.userId);
      const freshToken = mkToken({
        userId: user.id, email: user.email, name: user.name,
        stripeStatus: user.stripeStatus,
        freeAnalysesLeft: Math.max(0, (user.freeAnalysesLeft || 1) - 1),
      });
      res.setHeader('X-Fresh-Token', freshToken);
    }

    res.json({ type, analyse });
  } catch (err) {
    console.error('Analyse fout:', err);
    res.status(500).json({ error: 'Analyse mislukt. Probeer opnieuw.' });
  }
});

/**
 * POST /api/analyse/direct
 * Body: { prompt: '<volledige prompt>' }
 * Generieke Claude-aanroep voor bijv. schuldsanering-advies.
 */
router.post('/direct', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Geen prompt meegegeven.' });
  try {
    const text = await callClaude([{ role: 'user', content: prompt }], 3000);
    res.json({ text });
  } catch (err) {
    console.error('Direct analyse fout:', err);
    res.status(500).json({ error: 'Analyse mislukt.' });
  }
});


async function callClaude(messages, maxTokens = 1000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Anthropic API fout ' + response.status);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

export default router;
