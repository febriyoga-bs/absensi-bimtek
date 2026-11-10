import '@fortawesome/fontawesome-free/css/fontawesome.css';
import '@fortawesome/fontawesome-free/css/solid.css';
import '@fortawesome/fontawesome-free/css/brands.css';

export default function FontIcon({ name, brand = false }) {
  return <i className={`icon fa-${brand ? 'brands' : 'solid'} fa-${name}`} aria-hidden="true" />;
}
