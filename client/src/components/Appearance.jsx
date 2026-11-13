import { useEffect, useState } from 'react';
import '../modern.css';

const key = 'bimtek-appearance';
function readAppearance() {
  try { return localStorage.getItem(key) === 'classic' ? 'classic' : 'modern'; }
  catch { return 'modern'; }
}
document.documentElement.dataset.appearance = readAppearance();

export default function Appearance({ children }) {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'modern' ? '#f7faf9' : '#0b2e5c');
    try { localStorage.setItem(key, appearance); } catch { /* Pilihan tetap berlaku untuk sesi ini. */ }
  }, [appearance]);
  return <>
    <div className="appearance-bar">
      <span className="appearance-brand"><span aria-hidden="true" className="appearance-dot" />BIMTEK <span className="appearance-divider">/</span> <span>Workspace</span></span>
      <div className="appearance-control"><span className="appearance-label">Tampilan</span>
        <div className="appearance-switch" role="group" aria-label="Versi tampilan">
          {['classic', 'modern'].map((version) => <button key={version} type="button" aria-pressed={appearance === version}
            onClick={() => setAppearance(version)}>{version === 'classic' ? 'Classic' : 'Modern'}
            {appearance === version && <span aria-hidden="true"> ✓</span>}</button>)}
        </div>
      </div>
    </div>
    {children}
  </>;
}
