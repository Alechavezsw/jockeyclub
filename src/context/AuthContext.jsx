import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { allowLocalDemoAuth, isSupabaseConfigured, supabase } from '../lib/supabase';
import { ROLE_LABELS, canAccessAdmin, primaryRoleFromList } from '../domain/auth/roles';
import {
  SESSION_DESK,
  canUseMemberDesk,
  canUseOpsDesk,
  clearSessionDesk,
  effectiveRoleForDesk,
  homePathForDesk,
  isDualDeskUser,
  loadSessionDesk,
  persistSessionDesk,
  resolveSessionDesk,
} from '../domain/auth/sessionDesk';

const AuthContext = createContext(null);
const SESSION_KEY = 'jockey-auth-session';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Perfil mínimo desde la sesión auth: evita volver al login si falla el fetch del perfil. */
function skeletonFromAuth(sessionUser) {
  if (!sessionUser?.id) return null;
  return mapProfile(sessionUser, {
    full_name: sessionUser.user_metadata?.full_name,
    role: sessionUser.user_metadata?.role || 'member',
    profile_roles: [],
    member_number: sessionUser.user_metadata?.memberId || null,
  });
}

function loadLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mapProfile(sessionUser, profileRow) {
  const rolesRaw = Array.isArray(profileRow?.profile_roles)
    ? profileRow.profile_roles.filter((r) => !r.revoked_at)
    : [];
  const roles = rolesRaw.map((r) => ({
    roleKey: r.role_key || r.roleKey,
    label: r.label,
    kind: r.kind,
  }));
  const primary = primaryRoleFromList([
    profileRow?.role,
    ...roles.map((r) => r.roleKey),
  ]);

  return {
    id: sessionUser.id,
    email: sessionUser.email,
    fullName: profileRow?.full_name || sessionUser.user_metadata?.full_name || sessionUser.email,
    username: profileRow?.username || sessionUser.user_metadata?.username || null,
    contactEmail: profileRow?.contact_email || null,
    role: primary,
    roles: roles.length
      ? roles
      : [{ roleKey: primary, label: ROLE_LABELS[primary] || primary, kind: 'system' }],
    memberId: profileRow?.member_number || sessionUser.user_metadata?.memberId || null,
    disciplineIds: Array.isArray(profileRow?.discipline_ids)
      ? profileRow.discipline_ids
      : (Array.isArray(sessionUser.user_metadata?.disciplineIds)
        ? sessionUser.user_metadata.disciplineIds
        : null),
    isLocal: !isSupabaseConfigured,
  };
}

async function loadUserFromSession(sessionUser) {
  const email = String(sessionUser.email || '').trim();
  // Paralelo: perfil + roles + ficha (por vínculo o por el mismo correo).
  const [profileRes, roleRes, memberByProfile, memberByEmail] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, role, document_number, username, contact_email')
      .eq('id', sessionUser.id)
      .maybeSingle(),
    supabase
      .from('profile_roles')
      .select('role_key, label, kind, revoked_at')
      .eq('profile_id', sessionUser.id)
      .is('revoked_at', null),
    supabase
      .from('members')
      .select('member_number')
      .eq('profile_id', sessionUser.id)
      .limit(1),
    email
      ? supabase
        .from('members')
        .select('member_number')
        .ilike('email', email)
        .limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  let memberNumber = memberByProfile.data?.[0]?.member_number
    || memberByEmail.data?.[0]?.member_number
    || null;
  const documentNumber = String(profileRes.data?.document_number || '').replace(/\D/g, '');
  if (!memberNumber && documentNumber) {
    const { data: byDoc } = await supabase
      .from('members')
      .select('member_number')
      .eq('document_number', documentNumber)
      .limit(1);
    memberNumber = byDoc?.[0]?.member_number || null;
  }

  // Si entró por DNI/mail sin profile_id en la ficha, vincula una vez (best-effort).
  if (!memberByProfile.data?.[0]?.member_number) {
    try {
      const { data: linkedNumber } = await supabase.rpc('link_own_member_profile');
      if (linkedNumber) memberNumber = linkedNumber;
    } catch {
      /* ignore */
    }
  }

  return mapProfile(sessionUser, {
    ...profileRes.data,
    profile_roles: roleRes.data || [],
    member_number: memberNumber,
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /** Usuario auth de Supabase (sin perfil). El perfil se carga fuera de onAuthStateChange. */
  const [authUser, setAuthUser] = useState(null);
  const [desk, setDesk] = useState(() => loadSessionDesk());
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  /** Solo true cuando el usuario apretó “salir”: un SIGNED_OUT espurio no debe echarlo. */
  const logoutIntentRef = useRef(false);

  const applyMappedUser = useCallback((mapped) => {
    if (!mapped) {
      setUser(null);
      setDesk(null);
      return mapped;
    }
    const nextDesk = resolveSessionDesk(mapped, loadSessionDesk());
    setUser(mapped);
    setDesk(nextDesk);
    return mapped;
  }, []);

  const clearLocalAuth = useCallback(() => {
    setAuthUser(null);
    setUser(null);
    setDesk(null);
    setLoading(false);
  }, []);

  // Listener sync: NUNCA await supabase.* acá (deadlock → “sesión cerrada” / UI colgada)
  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured || !supabase) {
      const local = allowLocalDemoAuth ? loadLocalSession() : null;
      if (mounted) {
        if (local) {
          setUser(local);
          setDesk(resolveSessionDesk(local, loadSessionDesk()));
        } else {
          setUser(null);
          setDesk(null);
        }
        setLoading(false);
      }
      return () => { mounted = false; };
    }

    const recoverSession = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!mounted) return true;
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user) {
            setAuthUser(data.session.user);
            return true;
          }
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.session?.user) {
            setAuthUser(refreshed.session.user);
            return true;
          }
        } catch {
          /* reintento */
        }
        await sleep(200 * (attempt + 1));
      }
      return false;
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        // Logout deliberado → cerrar ya. Hipo del SDK al refrescar token → recuperar.
        if (logoutIntentRef.current) {
          logoutIntentRef.current = false;
          clearLocalAuth();
          return;
        }
        setTimeout(() => {
          void recoverSession().then((ok) => {
            if (!mounted || ok) return;
            clearLocalAuth();
          });
        }, 0);
        return;
      }

      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session?.user) setAuthUser(session.user);
        return;
      }

      const next = session?.user ?? null;
      setAuthUser(next);

      if (!next && event === 'INITIAL_SESSION') {
        setUser(null);
        setLoading(false);
      }
    });

    // Pestaña de nuevo visible: revalidar antes de que un refresh fallido dispare login.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !mounted) return;
      void recoverSession();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
      sub?.subscription?.unsubscribe?.();
    };
  }, [clearLocalAuth]);

  // Perfil en efecto aparte (libera el lock de auth antes de pegarle a PostgREST)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    if (!authUser?.id) return undefined;

    let cancelled = false;
    // No borrar al usuario actual: un fallo de red no puede mandarlo al login.
    setUser((prev) => (prev?.id === authUser.id ? prev : skeletonFromAuth(authUser)));

    const watchdog = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
    }, 4_000);

    (async () => {
      try {
        const mapped = await loadUserFromSession(authUser);
        if (!cancelled) {
          applyMappedUser(mapped);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUser((prev) => (prev?.id === authUser.id ? prev : skeletonFromAuth(authUser)));
          setLoading(false);
        }
      } finally {
        clearTimeout(watchdog);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [authUser?.id, applyMappedUser]);

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
        applyMappedUser(mapped);
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

    if (!allowLocalDemoAuth) {
      const err = new Error('El club no está conectado a la base. No se puede iniciar sesión local.');
      setAuthError(err.message);
      throw err;
    }

    // El chequeo de import.meta.env.DEV va pegado al import() para que el build de
    // producción elimine el chunk: allowLocalDemoAuth ya es false ahí, pero el bundler
    // no lo puede deducir y publicaba demoUsers (con contraseñas) como asset.
    const { DEMO_USERS } = import.meta.env.DEV
      ? await import('../domain/auth/demoUsers')
      : { DEMO_USERS: [] };
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
      disciplineIds: Array.isArray(demo.disciplineIds) ? demo.disciplineIds : null,
      isLocal: true,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    applyMappedUser(sessionUser);
    setLoading(false);
    return sessionUser;
  }, [applyMappedUser]);

  const logout = useCallback(async () => {
    setAuthError('');
    logoutIntentRef.current = true;
    if (isSupabaseConfigured && supabase) {
      // Solo esta pestaña/dispositivo. `global` cerraba TODAS las sesiones del
      // mismo usuario (p. ej. varios superadmin con la misma casilla).
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        logoutIntentRef.current = false;
      }
    } else {
      logoutIntentRef.current = false;
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('jockey-role');
    clearSessionDesk();
    clearLocalAuth();
    // Si el SDK no emite SIGNED_OUT, no dejar el flag trabado.
    setTimeout(() => { logoutIntentRef.current = false; }, 2_000);
  }, [clearLocalAuth]);

  const enterDesk = useCallback((next) => {
    if (next !== SESSION_DESK.member && next !== SESSION_DESK.ops) return;
    persistSessionDesk(next);
    setDesk(next);
  }, []);

  const switchDesk = useCallback((next) => {
    if (next !== SESSION_DESK.member && next !== SESSION_DESK.ops) return;
    persistSessionDesk(next);
    if (typeof window !== 'undefined') {
      window.location.assign(homePathForDesk(next));
    }
  }, []);

  const needsDeskChoice = Boolean(user) && !desk && isDualDeskUser(user);
  const effectiveRole = user ? effectiveRoleForDesk(user, desk) : null;
  const opsOnThisDesk = Boolean(
    user
    && desk === SESSION_DESK.ops
    && (canAccessAdmin(user.role) || (user.roles || []).some((r) => canAccessAdmin(r.roleKey)))
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      authError,
      desk,
      needsDeskChoice,
      canUseMemberDesk: canUseMemberDesk(user),
      canUseOpsDesk: canUseOpsDesk(user),
      isDualDesk: isDualDeskUser(user),
      isAuthenticated: Boolean(user),
      role: needsDeskChoice ? null : (effectiveRole || null),
      roles: user?.roles || [],
      roleLabel: effectiveRole ? ROLE_LABELS[effectiveRole] || effectiveRole : null,
      canAccessAdmin: opsOnThisDesk,
      isSupabase: isSupabaseConfigured,
      login,
      logout,
      enterDesk,
      switchDesk,
      setAuthError,
    }),
    [user, loading, authError, desk, needsDeskChoice, effectiveRole, opsOnThisDesk, login, logout, enterDesk, switchDesk]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook de conveniencia junto al provider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
