"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import GridManager from "@/components/GridManager";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  if (session === undefined) return <main className="min-h-screen grid place-items-center">Yükleniyor…</main>;
  const handleLogout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setMessage("Çıkış yapılamadı. Lütfen tekrar deneyin.");
  };
  if (!supabase) return <main className="min-h-screen grid place-items-center p-6 text-center">Supabase Auth yapılandırılmadı. <code>NEXT_PUBLIC_SUPABASE_URL</code> ve <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> ekleyin.</main>;

  const handleSignIn = async () => {
    setBusy(true); setMessage(null);
    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
  };

  const handleSignUp = async () => {
    setBusy(true); setMessage(null);
    const result = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (!result.data.session) setMessage("Hesap oluşturuldu. E-posta doğrulamasını tamamlayın.");
  };

  if (session) {
    return <GridManager userEmail={session.user.email ?? ""} onLogout={() => void handleLogout()} />;
  }

  return <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
    <form className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-sm" onSubmit={(event) => { event.preventDefault(); void handleSignIn(); }}>
      <h1 className="text-xl font-semibold">Dijivo Workspace</h1>
      <p className="mt-2 text-sm text-slate-600">Workspace’ınıza güvenle giriş yapın.</p>
      <label className="mt-5 block text-sm">E-posta<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="mt-3 block text-sm">Şifre<input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      {message && <p className="mt-3 text-sm text-rose-700">{message}</p>}
      <button disabled={busy} className="mt-5 w-full rounded bg-slate-900 p-2 text-white">Giriş yap</button>
      <button type="button" disabled={busy} onClick={() => void handleSignUp()} className="mt-3 w-full text-sm underline">İlk hesabı oluştur</button>
    </form>
  </main>;
}
