/**
 * Non-sensitive capability endpoint retained for old clients. Workspace data
 * itself is read directly through the authenticated Supabase client and RLS.
 */
export async function GET() {
  return Response.json({ auth: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) });
}
