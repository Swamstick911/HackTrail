import { useEffect, useState } from 'react';
import type { Profile } from '../../src/platform/contracts.js';
import { ApiError, api, useAction, useResource } from './api.js';
import { Auth } from './auth.js';
import { Icon, Loading, Notice } from './components.js';
import { Overview } from './overview.js';
import { ProjectPage, Projects } from './projects.js';
import { PublicReport, Reports } from './reports.js';
import { Connections, DeviceApproval } from './connections.js';
import { Settings } from './settings.js';
import { Community, PublicProfile } from './public.js';

const navigation = [
  { path: '/', label: 'Overview', icon: 'activity' },
  { path: '/projects', label: 'Projects', icon: 'folder' },
  { path: '/reports', label: 'Reports', icon: 'review' },
  { path: '/connections', label: 'Connections', icon: 'connect' },
  { path: '/settings', label: 'Settings', icon: 'shield' },
] as const;
export function App() {
  const [path, setPath] = useState(location.pathname);
  const profile = useResource<Profile>('/me');
  const action = useAction();
  useEffect(() => {
    const change = () => setPath(location.pathname);
    window.addEventListener('popstate', change);
    return () => window.removeEventListener('popstate', change);
  }, []);
  function navigate(next: string) {
    history.pushState({}, '', next);
    setPath(next);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const label = navigation.find((item) => item.path === path)?.label ?? 'Your project';
    document.title = 'HackTrail | ' + label;
  }, [path]);
  if (path === '/reset-password')
    return (
      <Auth
        onSignedIn={() => {
          navigate('/');
          profile.refresh();
        }}
      />
    );
  const publicView =
    path.startsWith('/u/') || path.startsWith('/reports/') || path === '/community';
  if (!publicView && (profile.loading || (!profile.data && !profile.error))) return <Loading />;
  if (!publicView && !profile.data) {
    if (profile.error instanceof ApiError && profile.error.status === 401)
      return (
        <Auth
          onSignedIn={() => {
            if (path === '/reset-password') navigate('/');
            profile.refresh();
          }}
        />
      );
    return (
      <div className="narrow page">
        <Notice error>{profile.error?.message ?? 'Could not load your account.'}</Notice>
        <button onClick={profile.refresh}>Try again</button>
      </div>
    );
  }
  const user = profile.data;
  let content;
  if (path.startsWith('/u/')) content = <PublicProfile key={path} handle={path.slice(3)} />;
  else if (path.startsWith('/reports/'))
    content = <PublicReport key={path} token={path.slice(9)} />;
  else if (path === '/community') content = <Community />;
  else if (user && path === '/connect') content = <DeviceApproval />;
  else if (user && path.startsWith('/projects/'))
    content = <ProjectPage key={path} id={path.slice(10)} navigate={navigate} />;
  else if (user && path === '/projects') content = <Projects navigate={navigate} />;
  else if (user && path === '/reports') content = <Reports navigate={navigate} />;
  else if (user && path === '/connections') content = <Connections />;
  else if (user && path === '/settings')
    content = (
      <Settings
        profile={user}
        refresh={profile.refresh}
        signedOut={() => {
          location.assign('/');
        }}
      />
    );
  else if (user && path === '/') content = <Overview profile={user} navigate={navigate} />;
  else
    content = (
      <Notice error>
        This page does not exist. <a href="/">Return to your workspace.</a>
      </Notice>
    );
  return (
    <div className={'app-shell' + (!user ? ' public-shell' : '')}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {user ? (
        <aside className="sidebar">
          <a
            className="brand"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            <img src="/favicon.svg" alt="" width={32} height={32} />
            HackTrail
          </a>
          <span className="sidebar-caption">Workspace</span>
          <nav aria-label="Main navigation">
            {navigation.map((item) => (
              <a
                key={item.path}
                href={item.path}
                className={
                  path === item.path || (item.path !== '/' && path.startsWith(item.path + '/'))
                    ? 'active'
                    : ''
                }
                aria-current={path === item.path ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.path);
                }}
              >
                <Icon name={item.icon} />
                {item.label}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a
              href="/community"
              onClick={(event) => {
                event.preventDefault();
                navigate('/community');
              }}
            >
              <Icon name="code" />
              Community
            </a>
            <a href="https://github.com/Swamstick911/HackTrail" target="_blank" rel="noreferrer">
              <Icon name="trail" />
              Open source
            </a>
            <div className="account-block">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{user.name}</strong>
                <a href={'/u/' + user.handle}>@{user.handle}</a>
              </div>
              <button
                className="icon-button"
                aria-label="Sign out"
                title="Sign out"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api('/auth/sign-out', {});
                    location.assign('/');
                  })
                }
              >
                <Icon name="power" />
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <header className="public-header">
          <a className="brand" href="/">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            HackTrail
          </a>
          <a className="button" href="/">
            Your workspace
          </a>
        </header>
      )}
      <main id="main" className="page">
        {action.error && <Notice error>{action.error}</Notice>}
        <div className="page-content" key={path}>
          {content}
        </div>
        <footer className="page-footer">
          <span>Keep a trail of what you make.</span>
          <a href="https://github.com/Swamstick911/HackTrail" target="_blank" rel="noreferrer">
            HackTrail · AGPLv3
          </a>
        </footer>
      </main>
    </div>
  );
}
