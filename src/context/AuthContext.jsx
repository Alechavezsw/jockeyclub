import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { DEMO_USERS } from '../domain/auth/demoUsers';
import { ROLE_LABELS, canAccessAdmin } from '../domain/auth/roles';

const AuthContext = createContext(null);
const SESSION_KEY = 'jockey-auth-session';

function loadLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mapProfile(sessionUser, profileRow) {
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    fullName: profileRow?.full_name || sessionUser.user_metadata?.full_name || sessionUser.email,
    role: profileRow?.role || sessionUser.user_metadata?.role || 'member',
    memberId: profileRow?.member_number || sessionUser.user_metadata?.memberId || null,
    isLocal: !isSupabaseConfigured,
  };
}

async function loadUserFromSession(sessionUser) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', sessionUser.id)
    .maybeSingle();

  // Siempre resolver credencial vinculada (no solo si role === member)
  const { data: member } = await supabase
    .from('members')
    .select('member_number')
    .eq('profile_id', sessionUser.id)
    .maybeSingle();

  return mapProfile(sessionUser, {
    ...profile,
    member_number: member?.member_number || null,
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /** Usuario auth de Supabase (sin perfil). El perfil se carga fuera de onAuthStateChange. */
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Listener sync: NUNCA await supabase.* acá (deadlock → “sesión cerrada” / UI colgada)
  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured || !supabase) {
      const local = loadLocalSession();
      if (mounted) {
        setUser(local);
        setLoading(false);
      }
      return () => { mounted = false; };
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        setAuthUser(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const next = session?.user ?? null;
      setAuthUser(next);

      if (!next && event === 'INITIAL_SESSION') {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // Perfil en efecto aparte (libera el lock de auth antes de pegarle a PostgREST)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    if (!authUser?.id) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const mapped = await loadUserFromSession(authUser);
        if (!cancelled) {
          setUser(mapped);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUser((prev) => prev || mapProfile(authUser, null));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authUser?.id]);

  const login = useCallback(async ({ email, password }) => {
    setAuthError('');
    const normalized = email.trim().toLowerCase();

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalized,
          password,
        });
        if (error) {
          setAuthError(
            error.message === 'Invalid login credentials'
              ? 'Email o contraseña incorrectos.'
              : (error.message || 'No se pudo iniciar sesión.')
          );
          throw error;
        }
        const mapped = await loadUserFromSession(data.user);
        setAuthUser(data.user);
        setUser(mapped);
        setLoading(false);
        return mapped;
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (/Invalid value|Failed to execute 'fetch'/i.test(msg)) {
          setAuthError(
            'Configuración de Supabase inválida (URL/clave). En Vercel: variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY sin comillas, luego Redeploy.'
          );
        }
        throw err;
      }
    }

    const demo = DEMO_USERS.find(
      (u) => u.email === normalized && u.password === password
    );
    if (!demo) {
      const err = new Error('Credenciales inválidas.');
      setAuthError(err.message);
      throw err;
    }
    const sessionUser = {
      id: demo.id,
      email: demo.email,
      fullName: demo.fullName,
      role: demo.role,
      memberId: demo.memberId,
      isLocal: true,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    setUser(sessionUser);
    setLoading(false);
    return sessionUser;
  }, []);

  const logout = useCallback(async () => {
    setAuthError('');
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('jockey-role');
    setAuthUser(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      authError,
      isAuthenticated: Boolean(user),
      role: user?.role || null,
      roleLabel: user ? ROLE_LABELS[user.role] || user.role : null,
      canAccessAdmin: user ? canAccessAdmin(user.role) : false,
      isSupabase: isSupabaseConfigured,
      login,
      logout,
      setAuthError,
    }),
    [user, loading, authError, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook de conveniencia junto al provider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
