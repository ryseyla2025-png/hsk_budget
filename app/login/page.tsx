import { redirect } from 'next/navigation';
import { auth, signIn, signOut } from '@/auth';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  AccessDenied: 'គណនី Google នេះមិនមានសិទ្ធិចូលប្រព័ន្ធទេ។ សូមទាក់ទង Admin ដើម្បីបញ្ចូលអ៊ីមែលរបស់អ្នក។',
  Configuration: 'ការកំណត់ប្រព័ន្ធមិនត្រឹមត្រូវ។ សូមទាក់ទង Admin។',
};

async function google() {
  'use server';
  await signIn('google', { redirectTo: '/' });
}

async function switchAccount() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const error = sp.error;
  if (session?.user?.email && !error) redirect('/');
  const msg = error ? MESSAGES[error] || 'មិនអាចចូលប្រព័ន្ធបានទេ។ សូមព្យាយាមម្ដងទៀត។' : '';

  return (
    <div className="login">
      <div className="login-card">
        <div className="crest">ព្រះរាជាណាចក្រកម្ពុជា · ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
        <h1 className="moul">វិទ្យាល័យ ហ៊ុន សែន កំពង់លាវ</h1>
        <p className="sub">ប្រព័ន្ធគ្រប់គ្រងថវិកាការបង្រៀនពេញម៉ោង</p>
        <div className="err">{msg}</div>
        {session?.user?.email ? (
          <form action={switchAccount}>
            <p className="help" style={{ marginTop: 0 }}>បានចូលជា <b>{session.user.email}</b></p>
            <button className="btn primary google-btn" type="submit">ចូលដោយគណនី Google ផ្សេង</button>
          </form>
        ) : (
          <form action={google}>
            <button className="btn primary google-btn" type="submit">
              <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
              ចូលប្រព័ន្ធដោយ Google
            </button>
          </form>
        )}
        <p className="help">ប្រើគណនី Google ដែល Admin បានចុះឈ្មោះក្នុងប្រព័ន្ធ</p>
      </div>
    </div>
  );
}
