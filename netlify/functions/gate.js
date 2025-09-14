// netlify/functions/gate.js
export default async (req, context) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok:false, error:'Use POST' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { name = '', email = '', company = '' } = await req.json();
    if (!name || !email || !company) {
      return new Response(JSON.stringify({ ok:false, error:'Missing name, email, or company' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE || 'Submissions';
    const key    = process.env.AIRTABLE_API_KEY; // PAT starting with "pat..."

    const body = {
      records: [{
        fields: {
          'Name': name,
          'Email': email,
          'Company': company,
        }
      }]
    };

    const resp = await fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ ok:false, error:'airtable_error', detail }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const json = await resp.json();
    return new Response(JSON.stringify({ ok:true, record: json.records[0] }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
};
