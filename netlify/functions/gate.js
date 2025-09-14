// netlify/functions/gate.js
export default async (req, context) => {
  const traceId = genTraceId();
  const cors = {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Trace-Id': traceId,
  };

  const dbg = (phase, data = {}) => {
    try {
      console.log(`[gate][${traceId}] ${phase}`, JSON.stringify(data));
    } catch {
      console.log(`[gate][${traceId}] ${phase}`, data);
    }
  };

  const respond = (status, payload) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });

  if (req.method !== 'POST') {
    dbg('method_not_allowed', { method: req.method });
    return respond(405, { ok: false, error: 'Use POST', where: 'method_gate' });
  }

  // --- Parse body
  let name = '', email = '', company = '';
  try {
    const bodyText = await req.text();
    dbg('parse_body_raw', { len: bodyText?.length ?? 0, snippet: bodyText?.slice(0, 200) ?? '' });
    const parsed = JSON.parse(bodyText || '{}');
    name = (parsed.name || '').trim();
    email = (parsed.email || '').trim();
    company = (parsed.company || '').trim();
    dbg('parse_body', { name_present: !!name, email_present: !!email, company_present: !!company });
  } catch (e) {
    dbg('parse_body_error', { error: String(e) });
    return respond(400, { ok: false, error: 'Invalid JSON body', where: 'parse_body' });
  }

  if (!name || !email || !company) {
    dbg('validation_error', { name_present: !!name, email_present: !!email, company_present: !!company });
    return respond(400, {
      ok: false,
      error: 'Missing name, email, or company',
      where: 'validate_payload',
    });
  }

  // --- Env validation
  const key = process.env.AIRTABLE_API_KEY || '';
  const baseId = process.env.AIRTABLE_BASE_ID || '';
  const table = process.env.AIRTABLE_TABLE || 'Submissions';

  const maskedKey =
    key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '(missing)';

  dbg('validate_env', {
    baseId_present: !!baseId,
    table,
    key_present: !!key,
    key_masked: maskedKey,
    key_looks_pat: key.startsWith('pat_'),
  });

  if (!key || !key.startsWith('pat_')) {
    return respond(500, {
      ok: false,
      error: 'Missing or invalid AIRTABLE_API_KEY (must start with pat_)',
      where: 'validate_env',
      hints: [
        'Create a Personal Access Token in Airtable',
        'Scope: data.records:write; grant base access',
        'Add to Netlify env as AIRTABLE_API_KEY and redeploy',
      ],
    });
  }
  if (!baseId) {
    return respond(500, {
      ok: false,
      error: 'Missing AIRTABLE_BASE_ID',
      where: 'validate_env',
      hints: ['Find it in Airtable API docs for your base', 'Set AIRTABLE_BASE_ID in Netlify env and redeploy'],
    });
  }

  // --- Build Airtable request
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
  const payload = {
    records: [
      {
        fields: {
          Name: name,
          Email: email,
          Company: company,
        },
      },
    ],
  };

  dbg('airtable_request', {
    url,
    table,
    baseId,
    payload_preview: payload, // fields only; safe
  });

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    dbg('airtable_response', { status: resp.status, body_snippet: text.slice(0, 500) });

    if (!resp.ok) {
      return respond(500, {
        ok: false,
        error: 'airtable_error',
        where: 'airtable_response',
        status: resp.status,
        detail: text,
        hints: [
          'Verify table name and field names (Name, Email, Company) match exactly',
          'Check that the token has access to this base',
          'Confirm the base ID is correct',
        ],
      });
    }

    const json = safeJson(text);
    return respond(200, { ok: true, record: json?.records?.[0] ?? null, traceId });

  } catch (err) {
    dbg('airtable_fetch_exception', { error: String(err) });
    return respond(500, {
      ok: false,
      error: String(err),
      where: 'airtable_fetch',
      hints: ['Check Netlify network egress', 'Retry; transient errors can happen'],
    });
  }
};

/* ---------- helpers ---------- */
function genTraceId() {
  // simple, readable trace id
  const rand = Math.random().toString(16).slice(2, 10);
  const ts = Date.now().toString(16);
  return `${ts}-${rand}`;
}
function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
