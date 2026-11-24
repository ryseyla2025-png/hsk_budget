import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import AppBoot from './AppBoot';

export const dynamic = 'force-dynamic';

async function logout() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

/**
 * App shell — same element ids as the original Index.html so the ported UI script works unchanged.
 * Elements are direct children of <body> (fragment) so the print CSS `body.printing > *:not(#printArea)` still works.
 */
export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');

  return (
    <>
      <div id="appShell" hidden>
        <header className="topbar">
          <div className="brand"><b id="tbSchool"></b><span id="tbYear"></span></div>
          <div className="spacer"></div>
          <span className="live" title="ទិន្នន័យធ្វើបច្ចុប្បន្នភាពដោយស្វ័យប្រវត្តិ រៀងរាល់ ៥ វិនាទី"><i id="liveDot"></i>ផ្ទាល់</span>
          <div className="who"><div id="tbUser"></div><small id="tbRole"></small></div>
          <form action={logout}>
            <button className="btn sm" type="submit">ចាកចេញ</button>
          </form>
        </header>
        <nav className="nav" id="nav"></nav>
        <main id="view"><div className="loading">កំពុងផ្ទុក…</div></main>
      </div>

      <div id="modal" className="modal" hidden><div className="modal-card" id="modalCard"></div></div>
      <div id="toast" className="toast" hidden></div>
      <div id="printArea"></div>
      <AppBoot />
    </>
  );
}
