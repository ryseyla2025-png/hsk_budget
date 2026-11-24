import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { checkLogin } from '@/lib/api';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  trustHost: true,
  callbacks: {
    /** Only Google accounts listed (Active=YES) in the Users sheet's Email column may sign in. */
    async signIn({ profile }) {
      if (!profile?.email || profile.email_verified === false) return false;
      return checkLogin(profile.email);
    },
  },
});
