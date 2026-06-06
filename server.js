require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');
const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const APP_KEY = process.env.APP_KEY || 'klarify2024';
const users = new Map();
const getUser = id => users.get(id) || null;
const setUser = (id, d) => { users.set(id, {...(getUser(id)||{}), ...d, id}); return getUser(id); };
const getUserByEmail = e => { for (const u of users.values()) if (u.email===e) return u; return null; };

function requireAccess(req, res, next) {
  const appKey = req.headers['x-app-key'];
  if (appKey === APP_KEY) return next();
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if (!token) return res.status(401).json({error:'Niet geautoriseerd.'});
  try { const p = jwt.verify(token, JWT_SECRET); req.user = getUser(p.id); next(); }
  catch(e) { res.status(401).json({error:'Ongeldige sessie.'}); }
}

app.use('/webhook', express.raw({type:'application/json'}), (req, res) => res.json({received:true}));
app.use(cors({origin: process.env.ALLOWED_ORIGIN||'*', credentials:true}));
app.use(express.json({limit:'10mb'}));
app.use('/api/', rateLimit({windowMs:15*60*1000, max:100}));

app.post('/api/auth/google', async (req,res) => {
  try {
    const {credential} = req.body;
    const parts = credential.split('.');
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    const {sub, email, name, picture} = payload;
    let user = getUserByEmail(email) || setUser(sub, {email, name, picture, stripeStatus:'none', credits:0});
    const token = jwt.sign({id:user.id}, JWT_SECRET, {expiresIn:'30d'});
    res.json({token, user});
  } catch(e) { res.status(500).json({error:'Login mislukt.'}); }
});

app.get('/api/auth/me', requireAccess, (req,res) => res.json({user:req.user||{}}));
app.get('/api/subscription/status', requireAccess, (req,res) => res.json({status:'none', credits:0}));

app.post('/api/analyse/direct', requireAccess, async (req,res) => {
  const {prompt, maxTokens, model} = req.body;
  if (!prompt) return res.status(400).json({error:'Geen prompt.'});
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model: model||'claude-sonnet-4-20250514', max_tokens: maxTokens||2000, messages:[{role:'user',content:prompt}]})
    });
    if(!r.ok){const e=await r.json().catch(()=>({}));return res.status(r.status).json({error:e.error?.message||'API fout'});}
    const d = await r.json();
    res.json({text: d.content?.[0]?.text||''});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/analyse/ocr', requireAccess, async (req,res) => {
  const {image, mediaType} = req.body;
  if (!image) return res.status(400).json({error:'Geen afbeelding.'});
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:4000, messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:mediaType||'image/jpeg',data:image}},
        {type:'text',text:'Lees alle tekst letterlijk over. Alleen de tekst.'}
      ]}]})
    });
    if(!r.ok){const e=await r.json().catch(()=>({}));return res.status(r.status).json({error:e.error?.message||'API fout'});}
    const d = await r.json();
    res.json({text: d.content?.[0]?.text||''});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/health', (_,res) => res.json({ok:true, ts:Date.now()}));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Klarify backend poort ' + PORT));
