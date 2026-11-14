import { Suspense, useEffect, useRef, useState } from 'react';

export default function DeferredSection({ id, title, children }) {
  const element = useRef(null);
  const [visible, setVisible] = useState(() => window.location.hash === `#${id}`);
  useEffect(() => {
    if (visible) return;
    const activateAnchor = () => { if (window.location.hash === `#${id}`) setVisible(true); };
    window.addEventListener('hashchange', activateAnchor);
    let observer;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
      });
      observer.observe(element.current);
    } else setVisible(true);
    return () => { observer?.disconnect(); window.removeEventListener('hashchange', activateAnchor); };
  }, [id, visible]);
  const placeholder = <section className="panel deferred-placeholder" aria-label={title}>
    <h2>{title}</h2><p className="muted" role="status">{visible ? 'Memuat segmen…' : 'Konten dimuat saat bagian ini terlihat.'}</p>
  </section>;
  return <div ref={element} id={id} className="landing-segment">
    {visible ? <Suspense fallback={placeholder}>{children}</Suspense> : placeholder}
  </div>;
}
