import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { landingSections } from '../lib/landingSections.js';
import '../theme.css';

const key = 'bimtek-color-mode';
function readAppearance() {
  try { return localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
document.documentElement.dataset.theme = readAppearance();
delete document.documentElement.dataset.appearance;

export default function Appearance({ children }) {
  const { pathname, hash } = useLocation();
  const landing = pathname === '/';
  const bar = useRef(null);
  const menuButton = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => { setMenuOpen(false); }, [pathname, hash]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event) => {
      if (!bar.current?.contains(event.target)) setMenuOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);
  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#0b1220' : '#0b2e5c');
    try { localStorage.setItem(key, appearance); } catch { /* Pilihan tetap berlaku untuk sesi ini. */ }
  }, [appearance]);
  useEffect(() => {
    const resize = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--topbar-height', `${bar.current?.getBoundingClientRect().height || 56}px`);
    });
    if (bar.current) resize.observe(bar.current);
    return () => resize.disconnect();
  }, [landing]);
  useEffect(() => {
    if (!landing) return;
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const threshold = (bar.current?.getBoundingClientRect().height || 56) + 80;
        let current = '';
        for (const { id } of landingSections) {
          if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= threshold) current = id;
        }
        setActiveSection(current);
      });
    };
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); };
  }, [landing, hash]);
  return <>
    <div ref={bar} className={`appearance-bar${landing ? ' appearance-bar--landing' : ''}`}>
      <span className="appearance-brand"><span aria-hidden="true" className="appearance-dot" />BIMTEK <span className="appearance-divider">/</span> <span>Workspace</span></span>
      {landing && <button ref={menuButton} className="landing-menu-toggle" type="button"
        aria-label={menuOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'} aria-expanded={menuOpen}
        aria-controls="landing-navigation" onClick={() => setMenuOpen((open) => !open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg><span>Menu</span>
      </button>}
      {landing && <nav id="landing-navigation" className={`landing-topbar-nav${menuOpen ? ' is-open' : ''}`} aria-label="Navigasi segmen beranda">
        {landingSections.map(({ id, label }) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} aria-current={activeSection === id ? 'location' : undefined}>{label}</a>)}
      </nav>}
      <div className="appearance-control"><span className="appearance-label">Tampilan</span>
        <div className="appearance-switch" role="group" aria-label="Mode warna">
          {['light', 'dark'].map((version) =>
            <button key={version} type="button" aria-pressed={appearance === version}
              onClick={() => setAppearance(version)}>{version === 'light' ? 'Light Mode' : 'Dark Mode'}
            </button>)
          }
        </div>
      </div>
    </div>
    {children}
  </>;
}
