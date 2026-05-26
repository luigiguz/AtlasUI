import { motion } from "framer-motion";
import { Loader2, Lock, User } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, apiUrl, setAccessToken, setRefreshToken } from "../apiClient";
import { PoweredByVerkkutech } from "./PoweredByVerkkutech";

const ATLAS_LOGO_FALLBACK = `/branding/${encodeURIComponent("Logo ATLAS - Sin Fondi.png")}`;

type AuthUser = { username: string; role: "admin" | "operator" | "viewer" };

type Props = {
  onDone: (u: AuthUser) => void;
};

function AtlasLoginLogo() {
  const [src, setSrc] = useState(ATLAS_LOGO_FALLBACK);

  return (
    <img
      src={src}
      alt="Atlas"
      onError={() => {
        const apiLogo = apiUrl("/api/logo");
        if (src !== apiLogo) setSrc(apiLogo);
      }}
      className="mx-auto h-28 w-auto max-w-[min(100%,20rem)] object-contain object-center sm:h-36 sm:max-w-[26rem]"
    />
  );
}

export function AuthLoginPanel({ onDone }: Props) {
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{
        ok: boolean;
        user: { username: string; role: string };
        access_token?: string;
        refresh_token?: string;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: user.trim(), password: pw }),
      });
      if (r.access_token) setAccessToken(r.access_token);
      else setAccessToken(null);
      if (r.refresh_token) setRefreshToken(r.refresh_token);
      else setRefreshToken(null);
      onDone({ username: r.user.username, role: r.user.role as AuthUser["role"] });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-cf-ink px-4 py-10 text-zinc-100 vpn-grid-bg">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_-5%,rgba(244,129,32,0.14),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 h-48 w-[min(100%,36rem)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(244,129,32,0.06),transparent_70%)]"
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <AtlasLoginLogo />
          <h2 className="font-display mt-6 text-2xl font-light tracking-wide text-zinc-400 sm:text-[1.65rem]">
            Bienvenido a{" "}
            <span className="font-semibold text-zinc-100">Atlas</span>
          </h2>
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4 rounded-2xl border border-cf-line/80 bg-[#111418]/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-white/[0.06] backdrop-blur-sm sm:p-8"
        >
          <div className="border-b border-cf-line/50 pb-4">
            <h1 className="text-lg font-semibold text-zinc-100">Iniciar sesión</h1>
            <p className="mt-0.5 text-xs text-zinc-500">Introduce tus credenciales de Atlas</p>
          </div>

          {err ? (
            <p
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
              role="alert"
            >
              {err}
            </p>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Usuario</span>
            <span className="relative flex">
              <User
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                aria-hidden
              />
              <input
                className="w-full rounded-lg border border-cf-line bg-black/35 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/25"
                placeholder="admin"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="username"
                required
                disabled={busy}
              />
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Contraseña</span>
            <span className="relative flex">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                aria-hidden
              />
              <input
                className="w-full rounded-lg border border-cf-line bg-black/35 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/25"
                placeholder="••••••••"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-cf-orange py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </button>

          <PoweredByVerkkutech compact className="border-t border-cf-line/50 pt-5" />
        </form>
      </motion.div>
    </div>
  );
}
