
export { }

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const text = await req.text()
    const body = text ? JSON.parse(text) : {}
    const endpoint = body.endpoint

    if (!endpoint) {
      throw new Error('Missing endpoint parameter')
    }

    // Construct ESPN API URL
    const baseUrl = 'https://site.api.espn.com/apis/site/v2/sports'
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const targetUrlRaw = `${baseUrl}/${cleanEndpoint}`;
    const targetUrl = targetUrlRaw.includes('?')
      ? `${targetUrlRaw}&_t=${Date.now()}`
      : `${targetUrlRaw}?_t=${Date.now()}`;

    console.log(`[ESPN Proxy] Fetching: ${targetUrl}`)

    const res = await fetch(targetUrl)

    if (!res.ok) {
      console.error(`[ESPN Proxy] Error ${res.status}: ${res.statusText}`)
      return new Response(JSON.stringify({ error: `ESPN API Error: ${res.status}` }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      })
    }

    const data = await res.json()

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=10' // Reduced to 10s for live data
      },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, // Return 200 to prevent CORS errors on the client side
    })
  }
})
