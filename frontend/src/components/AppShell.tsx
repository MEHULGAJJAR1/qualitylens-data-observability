import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Bell, ChevronRight, CircleHelp, Database, FileBarChart2,
  Gauge, LayoutDashboard, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings2,
  ShieldCheck, Sun, TableProperties, Workflow, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, StatusBadge } from './ui';
import { useTheme } from './theme';

const navigation = [
  { label: 'Overview', path: '/', icon: LayoutDashboard, group: 'workspace' },
  { label: 'Datasets', path: '/datasets', icon: Database, group: 'workspace' },
  { label: 'Data Quality', path: '/quality', icon: ShieldCheck, group: 'monitoring' },
  { label: 'Drift Monitoring', path: '/drift', icon: Activity, group: 'monitoring' },
  { label: 'Schema Changes', path: '/schema', icon: TableProperties, group: 'monitoring' },
  { label: 'Monitoring Runs', path: '/runs', icon: Workflow, group: 'monitoring' },
  { label: 'Alerts', path: '/alerts', icon: AlertTriangle, group: 'monitoring' },
  { label: 'Reports', path: '/reports', icon: FileBarChart2, group: 'monitoring' },
  { label: 'Settings', path: '/settings', icon: Settings2, group: 'settings' },
];
const titleByPath: Record<string, string> = Object.fromEntries(navigation.map((item) => [item.path, item.label]));

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 45000, retry: false });
  const notifications = useQuery({
    queryKey: ['alerts', 'open-preview'],
    queryFn: () => api.alerts({ status: 'open', page: 1, limit: 5 }),
    refetchInterval: 30000,
  });
  const title = titleByPath[location.pathname] || 'Overview';

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = search.trim();
    navigate(term ? `/datasets?q=${encodeURIComponent(term)}` : '/datasets');
    setMobileOpen(false);
  };

  const sidebar = <>
    <div className="sidebar-brand">
      <div className="brand-mark"><Gauge size={20} strokeWidth={2.4} /></div>
      {!collapsed && <div className="brand-copy"><span>quality<span className="brand-accent">lens</span></span><small>DATA OBSERVABILITY</small></div>}
      <button className="sidebar-close-mobile" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
    </div>
    <div className="sidebar-workspace">
      <div className="workspace-avatar">Q</div>
      {!collapsed && <div className="workspace-copy"><span>Analytics workspace</span><small>Local instance</small></div>}
      {!collapsed && <ChevronRight size={15} className="workspace-chevron" />}
    </div>
    <nav className="sidebar-nav" aria-label="Primary navigation">
      {!collapsed && <div className="nav-section-label">WORKSPACE</div>}
      {navigation.filter((item) => item.group === 'workspace').map((item) => <NavigationLink key={item.path} item={item} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />)}
      {!collapsed && <div className="nav-section-label nav-section-monitor">MONITORING</div>}
      {navigation.filter((item) => item.group === 'monitoring').map((item) => <NavigationLink key={item.path} item={item} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />)}
      {!collapsed && <div className="nav-section-label nav-section-monitor">PREFERENCES</div>}
      {navigation.filter((item) => item.group === 'settings').map((item) => <NavigationLink key={item.path} item={item} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />)}
    </nav>
    <div className="sidebar-footer">
      <div className={`connection-dot ${health.data?.database.connected ? 'connected' : ''}`} />
      {!collapsed && <div className="sidebar-footer-copy"><span>{health.data?.database.connected ? 'API connected' : health.isError ? 'API unreachable' : 'Checking API'}</span><small>{health.data?.database.kind || 'database status'}</small></div>}
      {!collapsed && <span className="sidebar-version">v1.0</span>}
    </div>
  </>;

  return <div className={`app-shell ${collapsed ? 'app-shell-collapsed' : ''}`}>
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>{sidebar}</aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`mobile-sidebar ${mobileOpen ? 'mobile-sidebar-open' : ''}`}>{sidebar}</aside>
    <div className="main-column">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button sidebar-toggle desktop-only" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><PanelLeftOpen size={19} /></button>
          <div className="breadcrumbs"><span>QualityLens</span><ChevronRight size={13} /><strong>{title}</strong></div>
        </div>
        <div className="topbar-right">
          <form className="global-search" onSubmit={submitSearch} role="search">
            <Search size={16} /><input aria-label="Search datasets" placeholder="Search datasets…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>↵</kbd>
          </form>
          <div className="header-divider" />
          <button className="icon-button theme-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} onClick={toggle}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="notification-wrap">
            <button className={`icon-button notification-button ${notificationsOpen ? 'icon-active' : ''}`} aria-label={`Notifications, ${notifications.data?.total ?? 0} open`} onClick={() => setNotificationsOpen((value) => !value)}>
              <Bell size={18} />{(notifications.data?.total ?? 0) > 0 && <span className="notification-count">{(notifications.data?.total ?? 0) > 9 ? '9+' : notifications.data?.total}</span>}
            </button>
            {notificationsOpen && <div className="notification-popover">
              <div className="notification-popover-head"><div><strong>Notifications</strong><span>{notifications.data?.total ?? 0} open alerts</span></div><Link to="/alerts" onClick={() => setNotificationsOpen(false)}>View all</Link></div>
              {notifications.isLoading ? <div className="notification-loading">Loading alerts…</div> : notifications.data?.items.length ? notifications.data.items.map((alert) => <Link className="notification-item" to="/alerts" key={alert.id} onClick={() => setNotificationsOpen(false)}>
                <span className={`notification-indicator ${alert.severity}`} /><div className="min-w-0 flex-1"><strong>{alert.title}</strong><span>{alert.dataset_name} · {formatDate(alert.created_at)}</span></div><StatusBadge status={alert.severity} />
              </Link>) : <div className="notification-empty"><ShieldCheck size={18} />You’re all caught up.</div>}
            </div>}
          </div>
          <div className="header-divider" />
          <button className="user-chip" onClick={() => navigate('/settings')} title="Open workspace settings"><span className="user-avatar">QL</span><span className="user-name">Local workspace</span><ChevronRight size={13} /></button>
        </div>
      </header>
      {health.isError && <div className="api-warning"><CircleHelp size={15} /><span>API unavailable — start the FastAPI backend at <code>localhost:8000</code> to load live data.</span><Link to="/settings">Connection help</Link></div>}
      <main className="main-content"><div className="page-enter"><Outlet /></div></main>
      <footer className="app-footer"><span>QualityLens · Data Quality &amp; Drift Monitoring</span><span>Local workspace · All times in your browser timezone</span></footer>
    </div>
  </div>;
}

function NavigationLink({ item, collapsed, onNavigate }: { item: typeof navigation[number]; collapsed: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return <NavLink to={item.path} end={item.path === '/'} onClick={onNavigate} title={collapsed ? item.label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
    <Icon size={18} strokeWidth={1.9} /><span>{item.label}</span>{item.path === '/alerts' && <span className="nav-alert-dot" />}
  </NavLink>;
}
