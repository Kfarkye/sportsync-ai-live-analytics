
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, FC } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
    user: SupabaseUser | null;
    isLoadingAuth: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);

    useEffect(() => {
        if (!isSupabaseConfigured()) {
            setIsLoadingAuth(false);
            return;
        }

        supabase.auth
            .getSession()
            .then(({ data: { session } }) => {
                setUser(session?.user ?? null);
            })
            .finally(() => setIsLoadingAuth(false));

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_evt, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = useCallback(async () => {
        if (isSupabaseConfigured()) await supabase.auth.signOut();
        setUser(null);
    }, []);

    const value = useMemo(
        () => ({ user, isLoadingAuth, signOut }),
        [user, isLoadingAuth, signOut]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
