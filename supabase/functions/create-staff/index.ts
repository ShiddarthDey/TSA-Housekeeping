import { createClient } from 'npm:@supabase/supabase-js@2'

function json(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  })
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function randomPassword(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return json(500, { error: 'Missing Supabase environment variables' }, cors)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  if (!token) return json(401, { error: 'Missing Authorization header' }, cors)

  const requesterClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })

  const { data: requester, error: requesterError } = await requesterClient.auth.getUser()
  if (requesterError || !requester.user) return json(401, { error: 'Invalid token' }, cors)

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: requesterProfile, error: profileError } = await adminClient
    .from<{ role: string }>('profiles')
    .select('role')
    .eq('id', requester.user.id)
    .maybeSingle()

  if (profileError) return json(500, { error: profileError.message }, cors)

  const requesterRole = typeof requesterProfile?.role === 'string' ? requesterProfile.role : ''
  if (requesterRole !== 'manager' && requesterRole !== 'supervisor') {
    return json(403, { error: 'Forbidden' }, cors)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' }, cors)
  }

  const email = typeof (body as { email?: unknown })?.email === 'string' ? (body as { email: string }).email.trim() : ''
  const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name.trim() : ''
  const role = typeof (body as { role?: unknown })?.role === 'string' ? (body as { role: string }).role.trim() : ''

  if (!email || !email.includes('@')) return json(400, { error: 'Email is required' }, cors)
  if (!name) return json(400, { error: 'Full Name is required' }, cors)
  if (role !== 'ra' && role !== 'houseman' && role !== 'public_area') return json(400, { error: 'Invalid role' }, cors)

  const password = randomPassword(12)
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  })

  if (createError || !created.user) return json(400, { error: createError?.message ?? 'Failed to create user' }, cors)

  const { error: profileInsertError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    role,
    name,
  })

  if (profileInsertError) {
    await adminClient.auth.admin.deleteUser(created.user.id)
    return json(400, { error: profileInsertError.message }, cors)
  }

  return json(
    200,
    {
      id: created.user.id,
      email,
      role,
      temporaryPassword: password,
    },
    cors,
  )
})
