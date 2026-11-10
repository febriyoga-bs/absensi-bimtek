import FontIcon from './FontIcon.jsx';

export default function WhatsAppLink({ phone, name }) {
  const digits = String(phone || '').replace(/\D/g, '');
  const number = digits.startsWith('08') ? '62' + digits.slice(1) : digits.startsWith('8') ? '62' + digits : digits;
  if (!/^628\d{7,11}$/.test(number)) return null;
  return <a className="whatsapp-link" href={`https://wa.me/${number}`} target="_blank" rel="noopener noreferrer"
    aria-label={`Hubungi ${name} di WhatsApp`} title="Buka chat WhatsApp"><FontIcon name="whatsapp" brand /></a>;
}
